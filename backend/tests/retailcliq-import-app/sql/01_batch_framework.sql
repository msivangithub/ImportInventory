/* =====================================================================================
   RetailCLIQ Universal Import — Batch Framework (chunked, resumable, reversible)
   Target: RC26ERP_DEV (SQL Server 2016+ : FOR JSON / OPENJSON / STRING_SPLIT / sp_getapplock)
   -------------------------------------------------------------------------------------
   HOW IT GUARANTEES COMPLETION
     - A batch = header row in ImportBatch + N chunks in ImportBatchChunk.
     - Each chunk is ONE transaction (XACT_ABORT ON). SQL Server itself rolls back any chunk
       whose connection dies mid-way, so after ANY interruption a chunk is either
       Committed (and fully traced in ImportBatchTrace) or Pending. Nothing in between.
     - proc_Import_Resume re-posts Pending chunks only. proc_Import_Rollback reverses
       Committed chunks from the trace (inserts deleted, updates restored from before-image).
     - proc_Import_Reconcile compares staging vs posted totals and is the only thing that
       can set Status = 'Reconciled'. The UI's "Import completed" = Reconciled.
     - sp_getapplock on the BatchId prevents two workers posting the same batch.

   POSTING MODE
     Mode 'LEGACY' (default): each chunk is copied into the legacy shape and
       proc_StockImportwithSupplier is called INSIDE the chunk transaction, so existing
       item-code / barcode / GST logic is preserved. Before-images are snapshotted for the
       chunk's OEM codes and new rows are detected by diffing — this is what makes a
       legacy proc rollback-able without touching it.
     Mode 'NATIVE': set-based INSERT…SELECT (section 7) — fill in once Itemmaster /
       Price_Master / Invtransaction column lists are confirmed (marked VERIFY).

   RUN ORDER: 1 → 8. Re-runnable (IF NOT EXISTS / CREATE OR ALTER).
   ===================================================================================== */
USE [RC26ERP_DEV];
GO
SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
GO

/* ===================================== 1. HBS helpers ===================================== */
CREATE OR ALTER FUNCTION dbo.fn_HBS (@d date) RETURNS int WITH SCHEMABINDING AS
BEGIN  -- identical to dbo.englishHBS: (year-1950)*416 + month*32 + day
    RETURN CASE WHEN @d IS NULL THEN NULL ELSE (DATEPART(yyyy,@d)-1950)*416 + DATEPART(mm,@d)*32 + DATEPART(dd,@d) END;
END
GO
CREATE OR ALTER FUNCTION dbo.fn_HBSToDate (@n int) RETURNS date WITH SCHEMABINDING AS
BEGIN  -- inverse of dbo.ConvertHBSDate
    RETURN CASE WHEN @n IS NULL OR @n < 33 THEN NULL
           ELSE TRY_CONVERT(date, DATEFROMPARTS(@n/416 + 1950, (@n%416)/32, (@n%416)%32)) END;
END
GO
/* Parse a text date in the batch's declared order (DMY / MDY / YMD / HBS int / dd-Mon-yyyy) */
CREATE OR ALTER FUNCTION dbo.fn_ParseImportDate (@s varchar(50), @order char(3)) RETURNS date AS
BEGIN
    DECLARE @v varchar(50) = LTRIM(RTRIM(ISNULL(@s,'')));
    IF @v = '' RETURN NULL;
    IF @v NOT LIKE '%[^0-9]%' AND LEN(@v) BETWEEN 4 AND 5 RETURN dbo.fn_HBSToDate(CONVERT(int,@v));   -- already HBS
    IF @v LIKE '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]%' RETURN TRY_CONVERT(date, LEFT(@v,10), 23);   -- ISO
    SET @v = REPLACE(REPLACE(@v,'.','/'),'-','/');
    IF @v LIKE '[0-9]%/[A-Za-z]%/[0-9]%' RETURN TRY_CONVERT(date, REPLACE(@v,'/','-'), 106);           -- dd-Mon-yyyy
    RETURN CASE @order WHEN 'MDY' THEN TRY_CONVERT(date,@v,101) WHEN 'YMD' THEN TRY_CONVERT(date,@v,111) ELSE TRY_CONVERT(date,@v,103) END;
END
GO
/* Numbers in the batch's declared style: DOT (1,234.56 / 12,34,567.89) or COMMA (1.234,56) */
CREATE OR ALTER FUNCTION dbo.fn_ParseImportNumber (@s varchar(50), @style varchar(5)) RETURNS decimal(18,4) AS
BEGIN
    DECLARE @v varchar(50) = LTRIM(RTRIM(ISNULL(@s,'')));
    IF @v = '' RETURN NULL;
    SET @v = REPLACE(REPLACE(REPLACE(@v,'₹',''),'Rs.',''),' ','');
    IF @style = 'COMMA' SET @v = REPLACE(REPLACE(@v,'.',''),',','.'); ELSE SET @v = REPLACE(@v,',','');
    IF @v LIKE '(%)' SET @v = '-' + SUBSTRING(@v,2,LEN(@v)-2);
    RETURN TRY_CONVERT(decimal(18,4), @v);
END
GO

/* ================================= 2. Staging table changes ================================= */
IF COL_LENGTH('dbo.Stock_Import_Export','BatchId') IS NULL
    ALTER TABLE dbo.Stock_Import_Export ADD
        BatchId   varchar(30)  NULL,
        RowNo     int          NULL,
        ChunkNo   int          NULL,
        RowStatus char(1)      NOT NULL CONSTRAINT DF_SIE_RowStatus DEFAULT 'P',   -- P pending, V valid, W warning, E error, S skipped, C committed
        ErrorMsg  nvarchar(1000) NULL,
        TransDateHBS int       NULL,        -- resolved from TransDate once, by fn_ParseImportDate
        ExpiryDateHBS int      NULL,
        PackedDateHBS int      NULL,
        BatchNo   varchar(50)  NULL,        -- VERIFY: only if the legacy table lacks these three
        PackedDate varchar(50) NULL,
        ExpiryDate varchar(50) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.Stock_Import_Export') AND name = 'IX_SIE_Batch_Row')
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.Stock_Import_Export') AND type = 1)
        CREATE UNIQUE CLUSTERED INDEX IX_SIE_Batch_Row ON dbo.Stock_Import_Export (BatchId, RowNo);
    ELSE
        CREATE UNIQUE NONCLUSTERED INDEX IX_SIE_Batch_Row ON dbo.Stock_Import_Export (BatchId, RowNo);
    CREATE NONCLUSTERED INDEX IX_SIE_Batch_Chunk ON dbo.Stock_Import_Export (BatchId, ChunkNo, RowStatus);
END
GO

/* ================================= 3. Batch control tables ================================= */
IF OBJECT_ID('dbo.ImportBatch') IS NULL
CREATE TABLE dbo.ImportBatch (
    BatchId        varchar(30)   NOT NULL CONSTRAINT PK_ImportBatch PRIMARY KEY,
    ImportType     varchar(30)   NOT NULL,            -- STOCK, ITEM, SUPPLIER, CUSTOMER, BALANCE, SALES, PURCHASE
    CompId         varchar(10)   NOT NULL,
    BranchId       varchar(20)   NOT NULL,
    UserId         varchar(20)   NOT NULL,
    SourceName     nvarchar(260) NULL,
    PostMode       varchar(10)   NOT NULL CONSTRAINT DF_IB_PostMode DEFAULT 'LEGACY',   -- LEGACY | NATIVE
    PurchaseAccount varchar(20)  NULL,                -- M_GeneralLedger.GlId for proc_StockImportwithSupplier
    DateOrder      char(3)       NOT NULL CONSTRAINT DF_IB_DateOrder DEFAULT 'DMY',
    NumberStyle    varchar(5)    NOT NULL CONSTRAINT DF_IB_NumStyle DEFAULT 'DOT',
    Region         varchar(10)   NULL,
    DupKeyColumns  varchar(200)  NOT NULL CONSTRAINT DF_IB_DupKey DEFAULT 'OEMCode',   -- industry profile: 'OEMCode,Size,Color' / 'OEMCode,BatchNo'
    DupMode        varchar(5)    NOT NULL CONSTRAINT DF_IB_DupMode DEFAULT 'ERROR',    -- ERROR | WARN | ALLOW
    DbMode         varchar(10)   NOT NULL CONSTRAINT DF_IB_DbMode DEFAULT 'RUNNING',   -- FRESH | RUNNING
    ChunkSize      int           NOT NULL CONSTRAINT DF_IB_ChunkSize DEFAULT 50000,
    Status         varchar(15)   NOT NULL CONSTRAINT DF_IB_Status DEFAULT 'Staging',
                   -- Staging → Validated → Posting → Posted → Reconciled | Failed | Cancelled | RolledBack
    TotalRows      int NULL, RowsValid int NULL, RowsWarn int NULL, RowsError int NULL, RowsPosted int NULL,
    MRNo           nvarchar(400) NULL,                -- concatenated @MRNo outputs per chunk
    StartedAt      datetime2(0)  NOT NULL CONSTRAINT DF_IB_Started DEFAULT SYSDATETIME(),
    StartedOnHBS   int           NOT NULL CONSTRAINT DF_IB_StartedHBS DEFAULT ((DATEPART(yyyy,GETDATE())-1950)*416 + DATEPART(mm,GETDATE())*32 + DATEPART(dd,GETDATE())),
    EndedAt        datetime2(0)  NULL,
    Remarks        nvarchar(500) NULL,
    LastError      nvarchar(2000) NULL,
    RolledBackAt   datetime2(0)  NULL, RolledBackBy varchar(20) NULL, RollbackReason nvarchar(500) NULL
);
GO
IF OBJECT_ID('dbo.ImportBatchChunk') IS NULL
CREATE TABLE dbo.ImportBatchChunk (
    BatchId    varchar(30) NOT NULL CONSTRAINT FK_IBC_Batch FOREIGN KEY REFERENCES dbo.ImportBatch(BatchId),
    ChunkNo    int         NOT NULL,
    FromRow    int NOT NULL, ToRow int NOT NULL,
    Status     varchar(12) NOT NULL CONSTRAINT DF_IBC_Status DEFAULT 'Pending',   -- Pending | Posting | Committed | Failed | RolledBack
    RowsOk     int NULL, RowsSkipped int NULL,
    MRNo       nvarchar(100) NULL,
    Attempts   int NOT NULL CONSTRAINT DF_IBC_Attempts DEFAULT 0,
    StartedAt  datetime2(0) NULL, EndedAt datetime2(0) NULL,
    ErrorMsg   nvarchar(2000) NULL,
    CONSTRAINT PK_ImportBatchChunk PRIMARY KEY (BatchId, ChunkNo)
);
GO
/* Every row the batch created or changed, with a before-image for changes → deterministic rollback */
IF OBJECT_ID('dbo.ImportBatchTrace') IS NULL
CREATE TABLE dbo.ImportBatchTrace (
    TraceId    bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_ImportBatchTrace PRIMARY KEY,
    BatchId    varchar(30) NOT NULL,
    ChunkNo    int         NOT NULL,
    TableName  sysname     NOT NULL,
    KeyCol     sysname     NOT NULL,          -- e.g. Itemcode, vend_uid, GlId, TransNo+RowId
    KeyValue   nvarchar(200) NOT NULL,
    Action     char(1)     NOT NULL,          -- I inserted, U updated
    BeforeImage nvarchar(max) NULL,           -- FOR JSON of the row before an update
    TracedAt   datetime2(0) NOT NULL CONSTRAINT DF_IBT_At DEFAULT SYSDATETIME(),
    INDEX IX_IBT_Batch (BatchId, ChunkNo, TableName)
);
GO

/* ---- 3b. legacy column reuse flag + Phase 2 tracker ---- */
IF COL_LENGTH('dbo.ImportBatch','LegacyReuse') IS NULL
    ALTER TABLE dbo.ImportBatch ADD LegacyReuse bit NOT NULL CONSTRAINT DF_IB_LegacyReuse DEFAULT 1;   -- 1 = send Fabric/ArtName/TransNo/TransDate exactly like frmOpeningStockwithSupplier
GO
IF COL_LENGTH('dbo.ImportBatch','GatePassed') IS NULL
    ALTER TABLE dbo.ImportBatch ADD GatePassed bit NOT NULL CONSTRAINT DF_IB_Gate DEFAULT 0, GateAt datetime2(0) NULL;
GO
IF OBJECT_ID('dbo.ImportPhase2Item') IS NULL
CREATE TABLE dbo.ImportPhase2Item (
    Id        int IDENTITY(1,1) CONSTRAINT PK_ImportPhase2Item PRIMARY KEY,
    Area      varchar(30)   NOT NULL,          -- PREFLIGHT | VALIDATION | POSTING | GST | SUPPLIER | IMPORTTYPE | DTO
    Item      nvarchar(200) NOT NULL,
    Detail    nvarchar(1000) NULL,             -- what the legacy code does / what must be confirmed on the tenant DB
    Source    nvarchar(200) NULL,              -- legacy file / proc the behaviour comes from
    Status    varchar(12)   NOT NULL CONSTRAINT DF_P2_Status DEFAULT 'OPEN',   -- OPEN | VERIFIED | DONE | WONTFIX
    Owner     varchar(40)   NULL,
    UpdatedAt datetime2(0)  NOT NULL CONSTRAINT DF_P2_Upd DEFAULT SYSDATETIME(),
    CONSTRAINT UQ_P2_Item UNIQUE (Area, Item)
);
GO
INSERT dbo.ImportPhase2Item (Area, Item, Detail, Source)
SELECT v.Area, v.Item, v.Detail, v.Source FROM (VALUES
 ('PREFLIGHT','Counter resolution (Sp_GetCounter by MAC)','Legacy form resolves the POS counter from the machine MAC. Tenant DB proc; confirm name/params, then call it from proc_Import_CheckPrerequisites.','frmOpeningStockwithSupplier'),
 ('POSTING','Confirm TransDate/PackedDate text format proc_StockImportwithSupplier expects','Legacy sends the raw PackedDate text in TransDate and raw ExpiryDate text in Fabric. Verify the proc parses dd-MMM-yyyy vs HBS int on a tenant DB.','MaterialReceipt_DA.OpeningStockwithSupplier'),
 ('POSTING','NATIVE post mode (set-based, no legacy proc)','Needs Itemmaster / Price_Master / Invtransaction column lists from db:check (9 VERIFY markers).','01_batch_framework.sql'),
 ('POSTING','UOMId blank handling inside the proc','Legacy sends UOMId blank. Confirm the proc defaults it; until then UOMId blank is a warning, not an error.','proc_StockImportwithSupplier'),
 ('GST','CGST/SGST/IGST/UTGST per+amt computation','Legacy sends zeros (AddTaxDetailsToGrid is commented out). Real values need state type (GlobalAddressBook/StateMaster) and vendor state (VendorMaster.CST). Currently zeros = legacy parity.','frmOpeningStockwithSupplier'),
 ('SUPPLIER','Supplier + M_GeneralLedger Sundry Creditors creation proc','Vendor insert proc name and M_GeneralLedger columns unknown; supplier outstanding opening balances not yet posted by the API.','Suppliers step'),
 ('VALIDATION','Item-level HSN default when Category has no HSNCode','Auto-fill uses CategoryMaster.HSNCode; rows whose category has none stay blank (warning only).','proc_Import_Validate'),
 ('IMPORTTYPE','Material Receipt / Franchise MR / Purchase Invoice / direct variants / FYC opening','Other MaterialReceipt_BL import flows. Same staging, different proc + header fields.','MaterialReceiptImport_BL'),
 ('DTO','Cascading discounts 1-5, invoice charges, scheme, ROL, ItemImage','DTO fields beyond the 39 staging columns.','MaterialReceipt_DTO')
) v(Area,Item,Detail,Source)
WHERE NOT EXISTS (SELECT 1 FROM dbo.ImportPhase2Item p WHERE p.Area=v.Area AND p.Item=v.Item);
GO

/* ================================= 4. Begin / status ================================= */
CREATE OR ALTER PROCEDURE dbo.proc_Import_Begin
    @ImportType varchar(30), @CompId varchar(10), @BranchId varchar(20), @UserId varchar(20),
    @SourceName nvarchar(260) = NULL, @PostMode varchar(10) = 'LEGACY', @PurchaseAccount varchar(20) = NULL,
    @DateOrder char(3) = 'DMY', @NumberStyle varchar(5) = 'DOT', @Region varchar(10) = 'en-IN',
    @DupKeyColumns varchar(200) = 'OEMCode', @DupMode varchar(5) = 'ERROR', @DbMode varchar(10) = 'RUNNING',
    @ChunkSize int = 50000, @Remarks nvarchar(500) = NULL,
    @BatchId varchar(30) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET @BatchId = 'IMP-' + CONVERT(char(8), GETDATE(), 112) + '-' + RIGHT(CONVERT(varchar(36), NEWID()), 6);
    INSERT dbo.ImportBatch (BatchId, ImportType, CompId, BranchId, UserId, SourceName, PostMode, PurchaseAccount, DateOrder, NumberStyle, Region, DupKeyColumns, DupMode, DbMode, ChunkSize, Remarks)
    VALUES (@BatchId, @ImportType, @CompId, @BranchId, @UserId, @SourceName, @PostMode, @PurchaseAccount, @DateOrder, @NumberStyle, @Region, @DupKeyColumns, @DupMode, @DbMode, @ChunkSize, @Remarks);
    -- Node now bulk-inserts Stock_Import_Export rows with this BatchId and RowNo = 1..n, then calls proc_Import_Validate
END
GO
CREATE OR ALTER PROCEDURE dbo.proc_Import_Status @BatchId varchar(30) AS
BEGIN
    SET NOCOUNT ON;
    SELECT b.*, ChunksTotal = (SELECT COUNT(*) FROM dbo.ImportBatchChunk c WHERE c.BatchId=b.BatchId),
                ChunksCommitted = (SELECT COUNT(*) FROM dbo.ImportBatchChunk c WHERE c.BatchId=b.BatchId AND c.Status='Committed'),
                RowsCommitted   = (SELECT ISNULL(SUM(RowsOk),0) FROM dbo.ImportBatchChunk c WHERE c.BatchId=b.BatchId AND c.Status='Committed')
    FROM dbo.ImportBatch b WHERE b.BatchId=@BatchId;
    SELECT * FROM dbo.ImportBatchChunk WHERE BatchId=@BatchId ORDER BY ChunkNo;
END
GO

/* ================================= 5. Set-based validation ================================= */
CREATE OR ALTER PROCEDURE dbo.proc_Import_Validate @BatchId varchar(30)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    DECLARE @order char(3), @num varchar(5), @dupKey varchar(200), @dupMode varchar(5), @chunk int, @dbMode varchar(10);
    SELECT @order=DateOrder, @num=NumberStyle, @dupKey=DupKeyColumns, @dupMode=DupMode, @chunk=ChunkSize, @dbMode=DbMode FROM dbo.ImportBatch WHERE BatchId=@BatchId;
    IF @order IS NULL THROW 50001, 'Unknown BatchId', 1;

    BEGIN TRAN;
    UPDATE dbo.Stock_Import_Export SET RowStatus='V', ErrorMsg=NULL,
        TransDateHBS  = dbo.fn_HBS(dbo.fn_ParseImportDate(TransDate , @order)),
        ExpiryDateHBS = dbo.fn_HBS(dbo.fn_ParseImportDate(ExpiryDate, @order)),
        PackedDateHBS = dbo.fn_HBS(dbo.fn_ParseImportDate(PackedDate, @order))
    WHERE BatchId=@BatchId;

    /* legacy parity: the legacy file has no transaction date column, so a blank TransDate means "today" (HBS) */
    UPDATE dbo.Stock_Import_Export SET TransDateHBS = dbo.fn_HBS(CAST(GETDATE() AS date))
    WHERE BatchId=@BatchId AND ISNULL(TransDate,'')='';

    /* legacy parity: HSN auto-fill from CategoryMaster when the file leaves it blank */
    UPDATE s SET Verticle1 = c.HSNCode
    FROM dbo.Stock_Import_Export s JOIN dbo.CategoryMaster c ON c.Status='S' AND (c.CatId=s.Category OR UPPER(c.CatName)=UPPER(s.Category))
    WHERE s.BatchId=@BatchId AND ISNULL(s.Verticle1,'')='' AND ISNULL(c.HSNCode,'')<>'';   -- VERIFY CategoryMaster.HSNCode

    /* --- errors: one UPDATE per rule, messages appended (set-based, no cursor) --- */
    DECLARE @rules TABLE (Seq int, Msg nvarchar(200), Pred nvarchar(1000), Sev char(1));
    INSERT @rules VALUES
     (1 ,'ItemDescription is mandatory',     'ISNULL(ItemDescription,'''')=''''', 'E'),
     (2 ,'UOMId blank (legacy sends blank; proc default applies)', 'ISNULL(UOMId,'''')=''''', 'W'),
     (3 ,'Qty is mandatory / not numeric',   'dbo.fn_ParseImportNumber(Qty,'''+@num+''') IS NULL', 'E'),
     (4 ,'Qty cannot be negative',           'dbo.fn_ParseImportNumber(Qty,'''+@num+''') < 0', 'E'),
     (5 ,'PurchasePrice mandatory / numeric','dbo.fn_ParseImportNumber(PurchasePrice,'''+@num+''') IS NULL', 'E'),
     (6 ,'PurchasePrice cannot be negative', 'dbo.fn_ParseImportNumber(PurchasePrice,'''+@num+''') < 0', 'E'),
     (7 ,'MRP not numeric',                  'ISNULL(MRP,'''')<>'''' AND dbo.fn_ParseImportNumber(MRP,'''+@num+''') IS NULL', 'E'),
     (8 ,'TransDate invalid ('+@order+')',   'ISNULL(TransDate,'''')<>'''' AND TransDateHBS IS NULL', 'E'),
     (9 ,'ExpiryDate invalid ('+@order+')',  'ISNULL(ExpiryDate,'''')<>'''' AND ExpiryDateHBS IS NULL', 'E'),
     (10,'ExpiryDate before TransDate',      'ExpiryDateHBS IS NOT NULL AND TransDateHBS IS NOT NULL AND ExpiryDateHBS < TransDateHBS', 'E'),
     (11,'Supplier is mandatory',            'ISNULL(Supplier,'''')=''''', 'E'),
     (12,'Category is mandatory',            'ISNULL(Category,'''')=''''', 'E'),
     (13,'Tax is mandatory',                 'ISNULL(Tax,'''')=''''', 'E'),
     (14,'DisType must be P or A',           'ISNULL(DisType,'''')<>'''' AND DisType NOT IN (''P'',''A'')', 'E'),
     (15,'Taxtype must be I or E',           'ISNULL(Taxtype,'''')<>'''' AND Taxtype NOT IN (''I'',''E'')', 'E'),
     (16,'InTaxtype must be I or E',         'ISNULL(InTaxtype,'''')<>'''' AND InTaxtype NOT IN (''I'',''E'')', 'E'),
     (17,'PurchaseDiscountType must be P or A','ISNULL(PurchaseDiscountType,'''')<>'''' AND PurchaseDiscountType NOT IN (''P'',''A'')', 'E'),
     (18,'Supplier not in vendormaster',     'NOT EXISTS (SELECT 1 FROM dbo.vendormaster v WHERE v.Status_id=''S'' AND (v.vend_uid=s.Supplier OR UPPER(v.vend_name)=UPPER(s.Supplier)))', 'E'),
     (19,'UOM not in UOMMaster',             'ISNULL(s.UOMId,'''')<>'''' AND NOT EXISTS (SELECT 1 FROM dbo.UOMMaster u WHERE u.UOMId=s.UOMId)', CASE WHEN @dbMode='FRESH' THEN 'W' ELSE 'E' END),  -- VERIFY column UOMId
     (20,'Tax not in Tax_Master',            'NOT EXISTS (SELECT 1 FROM dbo.Tax_Master t WHERE t.Tax_uid=s.Tax OR CONVERT(varchar(20),t.Tax_per)=s.Tax)', 'E'),
     (21,'Category not in CategoryMaster',   'NOT EXISTS (SELECT 1 FROM dbo.CategoryMaster c WHERE c.Status=''S'' AND (c.CatId=s.Category OR UPPER(c.CatName)=UPPER(s.Category)))', CASE WHEN @dbMode='FRESH' THEN 'W' ELSE 'E' END),
     (22,'Qty is zero',                      'dbo.fn_ParseImportNumber(Qty,'''+@num+''') = 0', 'W'),
     (23,'PurchasePrice exceeds MRP',        'dbo.fn_ParseImportNumber(MRP,'''+@num+''') > 0 AND dbo.fn_ParseImportNumber(PurchasePrice,'''+@num+''') > dbo.fn_ParseImportNumber(MRP,'''+@num+''')', 'W'),
     (24,'HSN (Verticle1) should be 4/6/8 digits','ISNULL(Verticle1,'''')<>'''' AND (Verticle1 LIKE ''%[^0-9]%'' OR LEN(Verticle1) NOT IN (4,6,8))', 'W');

    DECLARE @seq int, @msg nvarchar(200), @pred nvarchar(1000), @sev char(1), @sql nvarchar(max);
    DECLARE rc CURSOR LOCAL FAST_FORWARD FOR SELECT Seq, Msg, Pred, Sev FROM @rules ORDER BY Seq;   -- cursor over 24 RULES, never over rows
    OPEN rc; FETCH NEXT FROM rc INTO @seq,@msg,@pred,@sev;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @sql = N'UPDATE s SET RowStatus = CASE WHEN @sev=''E'' THEN ''E'' WHEN RowStatus=''E'' THEN ''E'' ELSE ''W'' END,
                     ErrorMsg = LEFT(ISNULL(ErrorMsg+''; '','''') + @msg, 1000)
                     FROM dbo.Stock_Import_Export s WHERE s.BatchId=@b AND (' + @pred + N')';
        EXEC sp_executesql @sql, N'@b varchar(30), @msg nvarchar(200), @sev char(1)', @BatchId, @msg, @sev;
        FETCH NEXT FROM rc INTO @seq,@msg,@pred,@sev;
    END
    CLOSE rc; DEALLOCATE rc;

    /* --- duplicates by industry profile key (e.g. 'OEMCode,Size,Color' for apparel) --- */
    IF @dupMode <> 'ALLOW'
    BEGIN
        DECLARE @keyExpr nvarchar(500) = (SELECT STRING_AGG('ISNULL(UPPER(' + QUOTENAME(LTRIM(RTRIM(value))) + '),'''')', '+''|''+') FROM STRING_SPLIT(@dupKey, ','));
        SET @sql = N';WITH d AS (SELECT RowNo, k = ' + @keyExpr + N', rn = ROW_NUMBER() OVER (PARTITION BY ' + @keyExpr + N' ORDER BY RowNo), first = MIN(RowNo) OVER (PARTITION BY ' + @keyExpr + N')
                      FROM dbo.Stock_Import_Export WHERE BatchId=@b)
                    UPDATE s SET RowStatus = CASE WHEN @mode=''ERROR'' THEN ''E'' WHEN s.RowStatus=''E'' THEN ''E'' ELSE ''W'' END,
                                 ErrorMsg = LEFT(ISNULL(s.ErrorMsg+''; '','''') + ''Duplicate '' + @key + '' (first at row '' + CONVERT(varchar(10), d.first) + '')'', 1000)
                    FROM dbo.Stock_Import_Export s JOIN d ON d.RowNo=s.RowNo WHERE s.BatchId=@b AND d.rn > 1 AND d.k <> ''''';
        EXEC sp_executesql @sql, N'@b varchar(30), @mode varchar(5), @key varchar(200)', @BatchId, @dupMode, @dupKey;
    END

    /* --- chunk assignment over valid+warning rows only; errors are skipped (RowStatus E) --- */
    ;WITH v AS (SELECT RowNo, rn = ROW_NUMBER() OVER (ORDER BY RowNo) FROM dbo.Stock_Import_Export WHERE BatchId=@BatchId AND RowStatus IN ('V','W'))
    UPDATE s SET ChunkNo = (v.rn-1)/@chunk + 1 FROM dbo.Stock_Import_Export s JOIN v ON v.RowNo=s.RowNo WHERE s.BatchId=@BatchId;

    DELETE dbo.ImportBatchChunk WHERE BatchId=@BatchId AND Status='Pending';
    INSERT dbo.ImportBatchChunk (BatchId, ChunkNo, FromRow, ToRow)
    SELECT BatchId, ChunkNo, MIN(RowNo), MAX(RowNo) FROM dbo.Stock_Import_Export WHERE BatchId=@BatchId AND ChunkNo IS NOT NULL
      AND ChunkNo NOT IN (SELECT ChunkNo FROM dbo.ImportBatchChunk WHERE BatchId=@BatchId) GROUP BY BatchId, ChunkNo;

    UPDATE dbo.ImportBatch SET Status='Validated', GatePassed=0, GateAt=NULL,
        TotalRows=(SELECT COUNT(*) FROM dbo.Stock_Import_Export WHERE BatchId=@BatchId),
        RowsValid=(SELECT COUNT(*) FROM dbo.Stock_Import_Export WHERE BatchId=@BatchId AND RowStatus='V'),
        RowsWarn =(SELECT COUNT(*) FROM dbo.Stock_Import_Export WHERE BatchId=@BatchId AND RowStatus='W'),
        RowsError=(SELECT COUNT(*) FROM dbo.Stock_Import_Export WHERE BatchId=@BatchId AND RowStatus='E')
    WHERE BatchId=@BatchId;
    COMMIT;

    SELECT Status, TotalRows, RowsValid, RowsWarn, RowsError, Chunks=(SELECT COUNT(*) FROM dbo.ImportBatchChunk WHERE BatchId=@BatchId) FROM dbo.ImportBatch WHERE BatchId=@BatchId;
    -- Error report for the UI / CSV download:
    -- SELECT RowNo, RowStatus, ErrorMsg, * FROM dbo.Stock_Import_Export WHERE BatchId=@BatchId AND RowStatus IN ('E','W') ORDER BY RowNo;
END
GO

/* ================================= 5b. Pre-flight + final gate + Phase 2 ================================= */
/* Mirrors the pre-checks frmOpeningStockwithSupplier runs before it will import anything.
   Result: Chk, Result (PASS | FAIL | WARN | PHASE2), Detail */
CREATE OR ALTER PROCEDURE dbo.proc_Import_CheckPrerequisites @BatchId varchar(30) = NULL, @PurchaseAccount varchar(20) = NULL, @PostMode varchar(10) = 'LEGACY'
AS
BEGIN
    SET NOCOUNT ON;
    IF @BatchId IS NOT NULL SELECT @PurchaseAccount = ISNULL(@PurchaseAccount, PurchaseAccount), @PostMode = PostMode FROM dbo.ImportBatch WHERE BatchId=@BatchId;
    DECLARE @r TABLE (Seq int IDENTITY, Chk varchar(60), Result varchar(6), Detail nvarchar(400));
    DECLARE @n int;

    SELECT @n = COUNT(*) FROM dbo.UOMMaster;          INSERT @r VALUES ('UOMMaster has rows',        CASE WHEN @n>0 THEN 'PASS' ELSE 'FAIL' END, CONCAT(@n,' rows (legacy: "UOM master is empty")'));
    SELECT @n = COUNT(*) FROM dbo.Tax_GroupMaster;    INSERT @r VALUES ('Tax_GroupMaster has rows',  CASE WHEN @n>0 THEN 'PASS' ELSE 'FAIL' END, CONCAT(@n,' rows'));
    SELECT @n = COUNT(*) FROM dbo.Barcodedef;         INSERT @r VALUES ('Barcodedef has rows',       CASE WHEN @n>0 THEN 'PASS' ELSE 'FAIL' END, CONCAT(@n,' rows (barcode generation needs a definition)'));
    SELECT @n = COUNT(*) FROM dbo.M_GeneralLedger WHERE GlId=@PurchaseAccount;   -- VERIFY M_GeneralLedger.GlId
    INSERT @r VALUES ('Purchase account exists',         CASE WHEN ISNULL(@PurchaseAccount,'')='' THEN 'FAIL' WHEN @n>0 THEN 'PASS' ELSE 'FAIL' END, ISNULL(NULLIF(@PurchaseAccount,''),'(none selected)'));
    INSERT @r VALUES ('proc_StockImportwithSupplier',    CASE WHEN OBJECT_ID('dbo.proc_StockImportwithSupplier','P') IS NOT NULL OR @PostMode<>'LEGACY' THEN 'PASS' ELSE 'FAIL' END, 'required for LEGACY post mode');
    DECLARE @miss nvarchar(400) = (SELECT STRING_AGG(c, ',') FROM (VALUES ('BatchId'),('RowNo'),('ChunkNo'),('RowStatus'),('BatchNo'),('PackedDate'),('ExpiryDate'),('Fabric'),('ArtName'),('TransNo'),('Verticle1')) v(c)
                                    WHERE COL_LENGTH('dbo.Stock_Import_Export', c) IS NULL);
    INSERT @r VALUES ('Staging columns present',         CASE WHEN @miss IS NULL THEN 'PASS' ELSE 'FAIL' END, ISNULL('missing: '+@miss,'all framework + legacy-reuse columns present'));
    INSERT @r VALUES ('Counter (Sp_GetCounter by MAC)',  'PHASE2', 'tenant DB proc — tracked in ImportPhase2Item');
    SELECT Chk, Result, Detail FROM @r ORDER BY Seq;
END
GO
/* Final gate: everything must be PASS (or an accepted WARN) before proc_Import_Post will run. Returns the check list. */
CREATE OR ALTER PROCEDURE dbo.proc_Import_Gate @BatchId varchar(30), @AllowErrors bit = 0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @r TABLE (Seq int IDENTITY, Chk varchar(60), Result varchar(6), Detail nvarchar(400));
    DECLARE @st varchar(15), @tot int, @v int, @w int, @e int, @p int, @chunks int, @ch int, @pa varchar(20), @mode varchar(10);
    SELECT @st=Status, @pa=PurchaseAccount, @mode=PostMode FROM dbo.ImportBatch WHERE BatchId=@BatchId;
    IF @st IS NULL THROW 50001,'Unknown BatchId',1;

    SELECT @tot=COUNT(*), @v=SUM(CASE WHEN RowStatus='V' THEN 1 ELSE 0 END), @w=SUM(CASE WHEN RowStatus='W' THEN 1 ELSE 0 END),
           @e=SUM(CASE WHEN RowStatus='E' THEN 1 ELSE 0 END), @p=SUM(CASE WHEN RowStatus='P' THEN 1 ELSE 0 END)
    FROM dbo.Stock_Import_Export WHERE BatchId=@BatchId;

    INSERT @r VALUES ('Batch validated',          CASE WHEN @st IN ('Validated','Posting') THEN 'PASS' ELSE 'FAIL' END, 'status = '+@st);
    INSERT @r VALUES ('No unvalidated rows',      CASE WHEN @p=0 THEN 'PASS' ELSE 'FAIL' END, CONCAT(@p,' rows still pending — re-run validation'));
    INSERT @r VALUES ('Row accounting',           CASE WHEN @tot=@v+@w+@e THEN 'PASS' ELSE 'FAIL' END, CONCAT(@tot,' = ',@v,' valid + ',@w,' warn + ',@e,' error'));
    INSERT @r VALUES ('Error rows',               CASE WHEN @e=0 THEN 'PASS' WHEN @AllowErrors=1 THEN 'WARN' ELSE 'FAIL' END, CONCAT(@e,' rows will be skipped and listed in the error report'));
    INSERT @r VALUES ('Warning rows',             CASE WHEN @w=0 THEN 'PASS' ELSE 'WARN' END, CONCAT(@w,' rows post with warnings'));
    SELECT @chunks=COUNT(*) FROM dbo.ImportBatchChunk WHERE BatchId=@BatchId;
    SELECT @ch=COUNT(DISTINCT ChunkNo) FROM dbo.Stock_Import_Export WHERE BatchId=@BatchId AND ChunkNo IS NOT NULL;
    INSERT @r VALUES ('Chunk plan matches rows',  CASE WHEN @chunks>0 AND @chunks>=@ch THEN 'PASS' ELSE 'FAIL' END, CONCAT(@chunks,' chunks planned for ',@v+@w,' postable rows'));
    INSERT @r VALUES ('Postable rows exist',      CASE WHEN @v+@w>0 THEN 'PASS' ELSE 'FAIL' END, CONCAT(@v+@w,' rows'));
    INSERT @r VALUES ('Duplicate barcode/itemcode in file', CASE WHEN EXISTS (SELECT 1 FROM dbo.Stock_Import_Export WHERE BatchId=@BatchId AND RowStatus IN ('V','W') AND ISNULL(ItemCode,'')<>'' GROUP BY ItemCode HAVING COUNT(*)>1) THEN 'FAIL' ELSE 'PASS' END, 'ItemCode must be unique within one file when supplied (OEMCode may repeat per industry key)');
    INSERT @r VALUES ('Totals captured for reconciliation', 'PASS',
        CONCAT('Qty=',(SELECT SUM(dbo.fn_ParseImportNumber(Qty,(SELECT NumberStyle FROM dbo.ImportBatch WHERE BatchId=@BatchId))) FROM dbo.Stock_Import_Export WHERE BatchId=@BatchId AND RowStatus IN ('V','W'))));

    CREATE TABLE #pre (Chk varchar(60), Result varchar(6), Detail nvarchar(400));
    INSERT #pre EXEC dbo.proc_Import_CheckPrerequisites @BatchId=@BatchId;
    INSERT @r SELECT 'Pre-flight: '+Chk, Result, Detail FROM #pre;
    INSERT @r SELECT 'Phase 2 open: '+Area, 'PHASE2', Item FROM dbo.ImportPhase2Item WHERE Status='OPEN';

    DECLARE @fail int = (SELECT COUNT(*) FROM @r WHERE Result='FAIL');
    UPDATE dbo.ImportBatch SET GatePassed = CASE WHEN @fail=0 THEN 1 ELSE 0 END, GateAt = SYSDATETIME() WHERE BatchId=@BatchId;
    SELECT Chk, Result, Detail FROM @r ORDER BY Seq;
    SELECT GatePassed = CASE WHEN @fail=0 THEN 1 ELSE 0 END, Failures=@fail, Phase2Open=(SELECT COUNT(*) FROM dbo.ImportPhase2Item WHERE Status='OPEN');
END
GO
CREATE OR ALTER PROCEDURE dbo.proc_Import_Phase2 @Id int = NULL, @Status varchar(12) = NULL, @Owner varchar(40) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @Id IS NOT NULL AND @Status IS NOT NULL UPDATE dbo.ImportPhase2Item SET Status=@Status, Owner=ISNULL(@Owner,Owner), UpdatedAt=SYSDATETIME() WHERE Id=@Id;
    SELECT Id, Area, Item, Status, Owner, Detail, Source, UpdatedAt FROM dbo.ImportPhase2Item ORDER BY CASE Status WHEN 'OPEN' THEN 0 ELSE 1 END, Area, Id;
END
GO

/* ================================= 6. Post ONE chunk (atomic + traced) ================================= */
CREATE OR ALTER PROCEDURE dbo.proc_Import_PostChunk @BatchId varchar(30), @ChunkNo int
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    DECLARE @compId varchar(10), @branch varchar(20), @user varchar(20), @mode varchar(10), @purAcc varchar(20), @num varchar(5), @status varchar(12);
    SELECT @compId=b.CompId, @branch=b.BranchId, @user=b.UserId, @mode=b.PostMode, @purAcc=b.PurchaseAccount, @num=b.NumberStyle
    FROM dbo.ImportBatch b WHERE b.BatchId=@BatchId;
    SELECT @status=Status FROM dbo.ImportBatchChunk WHERE BatchId=@BatchId AND ChunkNo=@ChunkNo;
    IF @status IS NULL THROW 50002, 'Unknown chunk', 1;
    IF @status = 'Committed' RETURN;                                   -- idempotent: re-running a committed chunk is a no-op

    UPDATE dbo.ImportBatchChunk SET Status='Posting', Attempts=Attempts+1, StartedAt=SYSDATETIME(), ErrorMsg=NULL WHERE BatchId=@BatchId AND ChunkNo=@ChunkNo;

    BEGIN TRY
        BEGIN TRAN;

        /* ---- 6a. before-images of everything this chunk may UPDATE (items that already exist) ---- */
        INSERT dbo.ImportBatchTrace (BatchId, ChunkNo, TableName, KeyCol, KeyValue, Action, BeforeImage)
        SELECT @BatchId, @ChunkNo, 'Itemmaster', 'Itemcode', i.Itemcode, 'U', (SELECT i.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
        FROM dbo.Itemmaster i
        WHERE EXISTS (SELECT 1 FROM dbo.Stock_Import_Export s WHERE s.BatchId=@BatchId AND s.ChunkNo=@ChunkNo AND s.RowStatus IN ('V','W')
                      AND (s.ItemCode=i.Itemcode OR (ISNULL(s.OEMCode,'')<>'' AND s.OEMCode=i.OEMCode)));
        INSERT dbo.ImportBatchTrace (BatchId, ChunkNo, TableName, KeyCol, KeyValue, Action, BeforeImage)
        SELECT @BatchId, @ChunkNo, 'Price_Master', 'Itemcode', p.Itemcode, 'U', (SELECT p.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
        FROM dbo.Price_Master p
        WHERE p.Itemcode IN (SELECT KeyValue FROM dbo.ImportBatchTrace WHERE BatchId=@BatchId AND ChunkNo=@ChunkNo AND TableName='Itemmaster' AND Action='U');

        /* ---- 6b. snapshot of keys that exist BEFORE posting, to detect inserts afterwards (LEGACY mode) ---- */
        CREATE TABLE #beforeItems (Itemcode varchar(20) PRIMARY KEY);
        INSERT #beforeItems SELECT Itemcode FROM dbo.Itemmaster;
        CREATE TABLE #beforeVend (vend_uid varchar(30) PRIMARY KEY);
        INSERT #beforeVend SELECT vend_uid FROM dbo.vendormaster;
        DECLARE @maxInv bigint = (SELECT ISNULL(MAX(RowId),0) FROM dbo.Invtransaction);   -- VERIFY: identity/row key of Invtransaction

        IF @mode = 'LEGACY'
        BEGIN
            /* ---- 6c. LEGACY: feed the chunk to proc_StockImportwithSupplier exactly as the form does ----
               The legacy proc reads dbo.Stock_Import_Export WITHOUT a BatchId filter, so we isolate it:
               move every other batch's rows aside for the duration of this transaction (single writer per server, enforced by applock 'ImportPost'). */
            EXEC sp_getapplock @Resource='ImportPost', @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=600000;
            SELECT * INTO #parked FROM dbo.Stock_Import_Export WHERE NOT (BatchId=@BatchId AND ChunkNo=@ChunkNo AND RowStatus IN ('V','W'));
            DELETE dbo.Stock_Import_Export WHERE NOT (BatchId=@BatchId AND ChunkNo=@ChunkNo AND RowStatus IN ('V','W'));
            -- normalise values the proc expects as plain text
            UPDATE dbo.Stock_Import_Export SET
                Qty = CONVERT(varchar(20), dbo.fn_ParseImportNumber(Qty,@num)),
                PurchasePrice = CONVERT(varchar(20), dbo.fn_ParseImportNumber(PurchasePrice,@num)),
                MRP = CONVERT(varchar(20), ISNULL(dbo.fn_ParseImportNumber(MRP,@num),0)),
                TransDate = CONVERT(varchar(20), TransDateHBS)
            WHERE BatchId=@BatchId AND ChunkNo=@ChunkNo;
            ;WITH n AS (SELECT SlNo, rn = ROW_NUMBER() OVER (ORDER BY RowNo) FROM dbo.Stock_Import_Export WHERE BatchId=@BatchId AND ChunkNo=@ChunkNo)
            UPDATE n SET SlNo = CONVERT(varchar(20), rn);
            /* legacy column reuse, exactly as frmOpeningStockwithSupplier builds its DataTable (see Phase 2: confirm date text format) */
            IF (SELECT LegacyReuse FROM dbo.ImportBatch WHERE BatchId=@BatchId) = 1
                UPDATE dbo.Stock_Import_Export SET
                    Fabric    = ISNULL(ExpiryDate,''),
                    ArtName   = ISNULL(ItemDescription,''),
                    TransNo   = ISNULL(BatchNo,''),
                    TransDate = ISNULL(PackedDate,'')
                WHERE BatchId=@BatchId AND ChunkNo=@ChunkNo;

            DECLARE @gst xml = (SELECT SlNo AS [@SlNo], ISNULL(NULLIF(ItemCode,''),OEMCode) AS [@Itemcode], Verticle1 AS [@HSNCode],
                                       0 AS [@CGST_Per],0 AS [@CGST_Amt],0 AS [@SGST_Per],0 AS [@SGST_Amt],0 AS [@IGST_Per],0 AS [@IGST_Amt],0 AS [@UTGST_Per],0 AS [@UTGST_Amt]
                                FROM dbo.Stock_Import_Export WHERE BatchId=@BatchId AND ChunkNo=@ChunkNo ORDER BY RowNo
                                FOR XML PATH('GST_ITEMS'), ROOT('GST'));
            DECLARE @mr nvarchar(100);
            EXEC dbo.proc_StockImportwithSupplier @CompId=@compId, @UserId=@user, @BranchId=@branch, @PurchaseAccount=@purAcc, @MRNo=@mr OUTPUT, @GSTXml=@gst;

            UPDATE dbo.ImportBatchChunk SET MRNo=@mr WHERE BatchId=@BatchId AND ChunkNo=@ChunkNo;
            -- restore the parked rows of other batches (the legacy proc may have cleared the table)
            DELETE dbo.Stock_Import_Export WHERE BatchId IS NULL OR BatchId<>@BatchId OR ChunkNo<>@ChunkNo;
            INSERT dbo.Stock_Import_Export SELECT * FROM #parked;
        END
        ELSE
        BEGIN
            /* ---- 6c'. NATIVE set-based posting — complete this once column lists are confirmed (VERIFY) ----
            INSERT dbo.Itemmaster (Itemcode, OEMCode, Itemdesc, UOMId, HSNCode, Tax_Uid, CatId, BrandId, ..., status)
            SELECT NEXT item code ..., s.OEMCode, s.ItemDescription, s.UOMId, s.Verticle1, t.Tax_uid, c.CatId, ..., 'A'
            FROM dbo.Stock_Import_Export s ... WHERE s.BatchId=@BatchId AND s.ChunkNo=@ChunkNo AND s.RowStatus IN ('V','W') AND NOT EXISTS (...);
            INSERT dbo.Price_Master (...);  INSERT dbo.Invtransaction (TransNo, TransDate, TransType, Itemcode, BranchId, Qty, Rate, MRP, BatchNo, ExpiryDate, vend_uid, CompId, UserId) SELECT ... s.TransDateHBS, 'OS', ... s.ExpiryDateHBS ...
            */
            THROW 50003, 'NATIVE post mode not configured yet — use LEGACY', 1;
        END

        /* ---- 6d. trace INSERTS by diffing against the snapshots ---- */
        INSERT dbo.ImportBatchTrace (BatchId, ChunkNo, TableName, KeyCol, KeyValue, Action)
        SELECT @BatchId, @ChunkNo, 'Itemmaster', 'Itemcode', i.Itemcode, 'I' FROM dbo.Itemmaster i WHERE NOT EXISTS (SELECT 1 FROM #beforeItems b WHERE b.Itemcode=i.Itemcode);
        INSERT dbo.ImportBatchTrace (BatchId, ChunkNo, TableName, KeyCol, KeyValue, Action)
        SELECT @BatchId, @ChunkNo, 'Price_Master', 'Itemcode', p.Itemcode, 'I' FROM dbo.Price_Master p WHERE NOT EXISTS (SELECT 1 FROM #beforeItems b WHERE b.Itemcode=p.Itemcode);
        INSERT dbo.ImportBatchTrace (BatchId, ChunkNo, TableName, KeyCol, KeyValue, Action)
        SELECT @BatchId, @ChunkNo, 'vendormaster', 'vend_uid', v.vend_uid, 'I' FROM dbo.vendormaster v WHERE NOT EXISTS (SELECT 1 FROM #beforeVend b WHERE b.vend_uid=v.vend_uid);
        INSERT dbo.ImportBatchTrace (BatchId, ChunkNo, TableName, KeyCol, KeyValue, Action)
        SELECT @BatchId, @ChunkNo, 'Invtransaction', 'RowId', CONVERT(varchar(20), t.RowId), 'I' FROM dbo.Invtransaction t WHERE t.RowId > @maxInv;   -- VERIFY key column

        /* ---- 6e. mark rows committed, close the chunk ---- */
        UPDATE dbo.Stock_Import_Export SET RowStatus='C' WHERE BatchId=@BatchId AND ChunkNo=@ChunkNo AND RowStatus IN ('V','W');
        UPDATE dbo.ImportBatchChunk SET Status='Committed', EndedAt=SYSDATETIME(),
               RowsOk=(SELECT COUNT(*) FROM dbo.Stock_Import_Export WHERE BatchId=@BatchId AND ChunkNo=@ChunkNo AND RowStatus='C')
        WHERE BatchId=@BatchId AND ChunkNo=@ChunkNo;
        COMMIT;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK;                                     -- the whole chunk, including its trace rows, is gone
        UPDATE dbo.ImportBatchChunk SET Status='Failed', EndedAt=SYSDATETIME(), ErrorMsg=LEFT(ERROR_MESSAGE(),2000) WHERE BatchId=@BatchId AND ChunkNo=@ChunkNo;
        UPDATE dbo.ImportBatch SET LastError=LEFT(ERROR_MESSAGE(),2000) WHERE BatchId=@BatchId;
        THROW;
    END CATCH
END
GO

/* ================================= 7. Post / Resume the batch ================================= */
CREATE OR ALTER PROCEDURE dbo.proc_Import_Post @BatchId varchar(30), @MaxChunks int = NULL   -- @MaxChunks lets Node post in slices and report progress
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @rc int;
    EXEC @rc = sp_getapplock @Resource=@BatchId, @LockMode='Exclusive', @LockOwner='Session', @LockTimeout=0;
    IF @rc < 0 THROW 50004, 'This batch is already being posted by another worker', 1;

    IF EXISTS (SELECT 1 FROM dbo.ImportBatch WHERE BatchId=@BatchId AND GatePassed=0 AND Status IN ('Validated'))
    BEGIN
        EXEC sp_releaseapplock @Resource=@BatchId, @LockOwner='Session';
        THROW 50005, 'Final gate not passed — run proc_Import_Gate first', 1;
    END
    BEGIN TRY
        /* a crash mid-chunk leaves Status='Posting' with its transaction already rolled back by SQL Server → safe to re-run */
        UPDATE dbo.ImportBatchChunk SET Status='Pending', ErrorMsg='Recovered from interrupted run' WHERE BatchId=@BatchId AND Status IN ('Posting','Failed');
        UPDATE dbo.ImportBatch SET Status='Posting', LastError=NULL WHERE BatchId=@BatchId AND Status IN ('Validated','Posting','Failed');

        DECLARE @chunk int, @done int = 0;
        WHILE 1 = 1
        BEGIN
            SELECT TOP 1 @chunk = ChunkNo FROM dbo.ImportBatchChunk WHERE BatchId=@BatchId AND Status='Pending' ORDER BY ChunkNo;
            IF @chunk IS NULL OR (@MaxChunks IS NOT NULL AND @done >= @MaxChunks) BREAK;
            IF EXISTS (SELECT 1 FROM dbo.ImportBatch WHERE BatchId=@BatchId AND Status='Cancelled') BREAK;   -- cooperative cancel at chunk boundary
            EXEC dbo.proc_Import_PostChunk @BatchId, @chunk;
            SET @done += 1; SET @chunk = NULL;
        END

        IF NOT EXISTS (SELECT 1 FROM dbo.ImportBatchChunk WHERE BatchId=@BatchId AND Status<>'Committed')
        BEGIN
            UPDATE dbo.ImportBatch SET Status='Posted', EndedAt=SYSDATETIME(),
                   RowsPosted=(SELECT SUM(RowsOk) FROM dbo.ImportBatchChunk WHERE BatchId=@BatchId),
                   MRNo=(SELECT STRING_AGG(MRNo, ', ') FROM dbo.ImportBatchChunk WHERE BatchId=@BatchId)
            WHERE BatchId=@BatchId;
            EXEC dbo.proc_Import_Reconcile @BatchId;
        END
    END TRY
    BEGIN CATCH
        UPDATE dbo.ImportBatch SET Status='Failed', LastError=LEFT(ERROR_MESSAGE(),2000) WHERE BatchId=@BatchId;
        EXEC sp_releaseapplock @Resource=@BatchId, @LockOwner='Session';
        THROW;
    END CATCH
    EXEC sp_releaseapplock @Resource=@BatchId, @LockOwner='Session';
    EXEC dbo.proc_Import_Status @BatchId;
END
GO
CREATE OR ALTER PROCEDURE dbo.proc_Import_Resume @BatchId varchar(30) AS
BEGIN  -- identical to Post: everything Committed is skipped, everything else is re-done
    EXEC dbo.proc_Import_Post @BatchId;
END
GO
CREATE OR ALTER PROCEDURE dbo.proc_Import_Cancel @BatchId varchar(30), @UserId varchar(20) AS
BEGIN  -- stops at the next chunk boundary; committed chunks stay (use Rollback to reverse them)
    UPDATE dbo.ImportBatch SET Status='Cancelled', Remarks=ISNULL(Remarks+' | ','')+'Cancelled by '+@UserId WHERE BatchId=@BatchId AND Status IN ('Validated','Posting');
END
GO

/* ================================= 8. Reconcile ================================= */
CREATE OR ALTER PROCEDURE dbo.proc_Import_Reconcile @BatchId varchar(30)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @num varchar(5) = (SELECT NumberStyle FROM dbo.ImportBatch WHERE BatchId=@BatchId);
    DECLARE @stRows int, @stQty decimal(18,4), @stVal decimal(18,4), @pRows int, @pQty decimal(18,4), @pVal decimal(18,4);
    SELECT @stRows=COUNT(*), @stQty=SUM(dbo.fn_ParseImportNumber(Qty,@num)), @stVal=SUM(dbo.fn_ParseImportNumber(Qty,@num)*dbo.fn_ParseImportNumber(PurchasePrice,@num))
    FROM dbo.Stock_Import_Export WHERE BatchId=@BatchId AND RowStatus='C';
    SELECT @pRows=COUNT(*), @pQty=SUM(t.Qty), @pVal=SUM(t.Qty*t.Rate)                     -- VERIFY: Invtransaction.Qty / Rate column names
    FROM dbo.Invtransaction t JOIN dbo.ImportBatchTrace tr ON tr.TableName='Invtransaction' AND tr.KeyValue=CONVERT(varchar(20),t.RowId)
    WHERE tr.BatchId=@BatchId AND tr.Action='I';

    DECLARE @ok bit = CASE WHEN @stRows=@pRows AND ABS(ISNULL(@stQty,0)-ISNULL(@pQty,0))<0.0001 AND ABS(ISNULL(@stVal,0)-ISNULL(@pVal,0))<0.01 THEN 1 ELSE 0 END;
    UPDATE dbo.ImportBatch SET Status = CASE WHEN @ok=1 THEN 'Reconciled' ELSE 'Failed' END,
           LastError = CASE WHEN @ok=1 THEN NULL ELSE CONCAT('Reconciliation mismatch: staging rows=',@stRows,' qty=',@stQty,' value=',@stVal,' | posted rows=',@pRows,' qty=',@pQty,' value=',@pVal) END
    WHERE BatchId=@BatchId;
    SELECT BatchId=@BatchId, Reconciled=@ok, StagingRows=@stRows, PostedRows=@pRows, StagingQty=@stQty, PostedQty=@pQty, StagingValue=@stVal, PostedValue=@pVal;
END
GO

/* ================================= 9. Rollback (whole batch, or from a chunk) ================================= */
CREATE OR ALTER PROCEDURE dbo.proc_Import_Rollback @BatchId varchar(30), @UserId varchar(20), @Reason nvarchar(500) = NULL, @FromChunk int = 1
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    DECLARE @rc int; EXEC @rc = sp_getapplock @Resource=@BatchId, @LockMode='Exclusive', @LockOwner='Session', @LockTimeout=0;
    IF @rc < 0 THROW 50005, 'Batch is busy (posting or another rollback)', 1;
    IF EXISTS (SELECT 1 FROM dbo.ImportBatch WHERE BatchId=@BatchId AND Status='Posting') THROW 50006, 'Cancel the batch first', 1;

    DECLARE @chunk int;
    SELECT @chunk = MAX(ChunkNo) FROM dbo.ImportBatchChunk WHERE BatchId=@BatchId AND Status='Committed' AND ChunkNo >= @FromChunk;
    WHILE @chunk IS NOT NULL                                             -- newest chunk first, each in its own transaction
    BEGIN
        BEGIN TRY
            BEGIN TRAN;
            -- 1. stock lines this chunk inserted
            DELETE t FROM dbo.Invtransaction t JOIN dbo.ImportBatchTrace tr ON tr.KeyValue=CONVERT(varchar(20),t.RowId)
              WHERE tr.BatchId=@BatchId AND tr.ChunkNo=@chunk AND tr.TableName='Invtransaction' AND tr.Action='I';
            -- 2. prices / items inserted (only if nothing else references them yet)
            DELETE p FROM dbo.Price_Master p JOIN dbo.ImportBatchTrace tr ON tr.KeyValue=p.Itemcode
              WHERE tr.BatchId=@BatchId AND tr.ChunkNo=@chunk AND tr.TableName='Price_Master' AND tr.Action='I';
            DELETE i FROM dbo.Itemmaster i JOIN dbo.ImportBatchTrace tr ON tr.KeyValue=i.Itemcode
              WHERE tr.BatchId=@BatchId AND tr.ChunkNo=@chunk AND tr.TableName='Itemmaster' AND tr.Action='I'
                AND NOT EXISTS (SELECT 1 FROM dbo.Invtransaction x WHERE x.Itemcode=i.Itemcode);            -- VERIFY
            -- 3. updates restored from before-image (JSON → row). Itemmaster shown; repeat for Price_Master with its column list.
            UPDATE i SET i.OEMCode=j.OEMCode, i.Itemdesc=j.Itemdesc, i.UOMId=j.UOMId, i.HSNCode=j.HSNCode, i.Tax_Uid=j.Tax_Uid, i.status=j.status   -- VERIFY column list = Itemmaster
              FROM dbo.Itemmaster i JOIN dbo.ImportBatchTrace tr ON tr.KeyValue=i.Itemcode
              CROSS APPLY OPENJSON(tr.BeforeImage) WITH (OEMCode varchar(50), Itemdesc varchar(200), UOMId nvarchar(30), HSNCode varchar(20), Tax_Uid varchar(20), status char(1)) j
              WHERE tr.BatchId=@BatchId AND tr.ChunkNo=@chunk AND tr.TableName='Itemmaster' AND tr.Action='U';
            UPDATE p SET p.MRP=j.MRP, p.dis_value=j.dis_value, p.dis_type=j.dis_type, p.S_std_Price=j.S_std_Price, p.Desc3=j.Desc3                 -- VERIFY column list = Price_Master
              FROM dbo.Price_Master p JOIN dbo.ImportBatchTrace tr ON tr.KeyValue=p.Itemcode
              CROSS APPLY OPENJSON(tr.BeforeImage) WITH (MRP decimal(18,4), dis_value decimal(18,4), dis_type varchar(10), S_std_Price decimal(18,4), Desc3 varchar(20)) j
              WHERE tr.BatchId=@BatchId AND tr.ChunkNo=@chunk AND tr.TableName='Price_Master' AND tr.Action='U';
            -- 4. suppliers + ledgers created by this chunk (only if unused elsewhere)
            DELETE g FROM dbo.M_GeneralLedger g JOIN dbo.ImportBatchTrace tr ON tr.KeyValue=g.GlId
              WHERE tr.BatchId=@BatchId AND tr.ChunkNo=@chunk AND tr.TableName='M_GeneralLedger' AND tr.Action='I';
            DELETE v FROM dbo.vendormaster v JOIN dbo.ImportBatchTrace tr ON tr.KeyValue=v.vend_uid
              WHERE tr.BatchId=@BatchId AND tr.ChunkNo=@chunk AND tr.TableName='vendormaster' AND tr.Action='I'
                AND NOT EXISTS (SELECT 1 FROM dbo.Invtransaction x WHERE x.vend_uid=v.vend_uid);              -- VERIFY
            -- 5. staging rows back to Valid, chunk back to RolledBack
            UPDATE dbo.Stock_Import_Export SET RowStatus='V' WHERE BatchId=@BatchId AND ChunkNo=@chunk AND RowStatus='C';
            UPDATE dbo.ImportBatchChunk SET Status='RolledBack', EndedAt=SYSDATETIME() WHERE BatchId=@BatchId AND ChunkNo=@chunk;
            DELETE dbo.ImportBatchTrace WHERE BatchId=@BatchId AND ChunkNo=@chunk;
            COMMIT;
        END TRY
        BEGIN CATCH
            IF XACT_STATE() <> 0 ROLLBACK;
            UPDATE dbo.ImportBatch SET LastError=LEFT('Rollback of chunk '+CONVERT(varchar(10),@chunk)+' failed: '+ERROR_MESSAGE(),2000) WHERE BatchId=@BatchId;
            EXEC sp_releaseapplock @Resource=@BatchId, @LockOwner='Session';
            THROW;
        END CATCH
        SELECT @chunk = MAX(ChunkNo) FROM dbo.ImportBatchChunk WHERE BatchId=@BatchId AND Status='Committed' AND ChunkNo >= @FromChunk;
    END
    UPDATE dbo.ImportBatch SET Status = CASE WHEN EXISTS (SELECT 1 FROM dbo.ImportBatchChunk WHERE BatchId=@BatchId AND Status='Committed') THEN 'Validated' ELSE 'RolledBack' END,
           RolledBackAt=SYSDATETIME(), RolledBackBy=@UserId, RollbackReason=@Reason WHERE BatchId=@BatchId;
    EXEC sp_releaseapplock @Resource=@BatchId, @LockOwner='Session';
    EXEC dbo.proc_Import_Status @BatchId;
END
GO

/* ================================= 10. Housekeeping ================================= */
CREATE OR ALTER PROCEDURE dbo.proc_Import_Purge @KeepDays int = 90 AS
BEGIN  -- staging rows of reconciled batches are not needed after the retention window; control tables are kept for audit
    DELETE s FROM dbo.Stock_Import_Export s JOIN dbo.ImportBatch b ON b.BatchId=s.BatchId
    WHERE b.Status IN ('Reconciled','RolledBack') AND b.EndedAt < DATEADD(day,-@KeepDays,SYSDATETIME());
END
GO

/* =====================================================================================
   NODE SERVICE CALL SEQUENCE (background job, not inside the HTTP request)
     1. EXEC proc_Import_Begin @ImportType='STOCK', @CompId, @BranchId, @UserId, @SourceName, @PostMode='LEGACY',
            @PurchaseAccount='24-HB0001', @DateOrder='DMY', @NumberStyle='DOT', @DupKeyColumns='OEMCode,Size,Color', @DupMode='ALLOW',
            @DbMode='FRESH', @ChunkSize=50000, @BatchId OUTPUT
     2. mssql bulk() into Stock_Import_Export in 50k slices, columns + BatchId + RowNo (1..n)     ← 50–150k rows/s
     3. EXEC proc_Import_Validate @BatchId                     → counts; UI shows error report from staging
     4. user confirms → EXEC proc_Import_Post @BatchId, @MaxChunks=5  (loop; between calls read proc_Import_Status for the progress bar)
     5. on any crash / restart: EXEC proc_Import_Resume @BatchId
     6. cancel button:          EXEC proc_Import_Cancel @BatchId, @UserId
     7. undo:                   EXEC proc_Import_Rollback @BatchId, @UserId, @Reason          (whole batch, newest chunk first)
   SMOKE TEST (after running this file):
     DECLARE @b varchar(30); EXEC proc_Import_Begin 'STOCK','C001','BMS10004','U10001','smoke.csv',@BatchId=@b OUTPUT;
     -- insert 3 staging rows with BatchId=@b, RowNo=1..3 ... EXEC proc_Import_Validate @b; EXEC proc_Import_Post @b; EXEC proc_Import_Rollback @b,'U10001','smoke';
   ===================================================================================== */
