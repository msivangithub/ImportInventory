'use strict';
const express = require('express');
const multer = require('multer');
const { sql, pool, query } = require('../lib/db');
const { parseBuffer } = require('../lib/parse');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Number(process.env.UPLOAD_LIMIT_MB || 512) * 1024 * 1024 } });
const COMP = process.env.COMP_ID || 'C001';

/* Exact Stock_Import_Export column list (from the SQL Profiler insert bulk) + batch columns + optional batch/expiry */
const STAGING_COLS = ['SlNo','ItemCode','OEMCode','ItemDescription','UOMId','Qty','PurchasePrice','MRP','Discount','DisType','DiscountPrice','Division','Department','Category','SubCategory','Style','Design','Size','Color','Brand','Fabric','ArtName','TransNo','TransDate','Tokens','Tax','Taxtype','PacketNo','CounterID','InTax','InTaxtype','Supplier','Verticle1','Verticle2','Verticle3','P_Distributor_rate','TokenType','PurchaseDiscount','PurchaseDiscountType'];
const EXTRA_COLS = ['BatchNo','PackedDate','ExpiryDate'];

/* Master lookups — the queries the legacy form runs (Profiler) + inferred ones marked so the UI can flag them */
const MASTER_SQL = {
  vendormaster:     { id:'vend_uid', name:'vend_name', sql:"select vend_uid as id, vend_name as name, '' as extra from vendormaster where Status_id='S'" },
  CategoryMaster:   { id:'CatId', name:'CatName', sql:"select CatId as id, CatName as name, HSNCode as extra from CategoryMaster where Status='S'" },
  UOMMaster:        { id:'UOMId', name:'UOMName', sql:"select UOMId as id, UOMName as name, '' as extra from UOMMaster", inferred:true },
  Tax_Master:       { id:'Tax_uid', name:'Tax_per', sql:"select Tax_uid as id, convert(varchar(20),Tax_per)+'% '+isnull(Tax_Type_Inc_Exl,'') as name, convert(varchar(20),Tax_per) as extra from Tax_Master" },
  Tax_GroupMaster:  { id:'TaxGroupId', name:'TaxGroupName', sql:"select * from Tax_GroupMaster", inferred:true },
  CounterMaster:    { id:'CounterId', name:'CounterName', sql:"select CounterId as id, CounterId as name, '' as extra from CounterMaster", inferred:true },
  M_GeneralLedger:  { id:'GlId', name:'GLName', sql:`select GlId as id, GLName as name, '' as extra from M_GeneralLedger where desc5=1 and GlType='P' and compid='${COMP}'` },
  BranchMaster:     { id:'BranchId', name:'BranchName', sql:"select BranchId as id, BranchName as name, '' as extra from BranchMaster", inferred:true },
  Itemmaster:       { id:'Itemcode', name:'Itemdesc', sql:"select top 5000 Itemcode as id, Itemdesc as name, OEMCode as extra from Itemmaster where status='A'" },
  DivisionMaster:   { id:'DivId', name:'DivName', sql:"select DivId as id, DivName as name, '' as extra from DivisionMaster", inferred:true },
  DepartmentMaster: { id:'SDMId', name:'SDMName', sql:"select SDMId as id, SDMName as name, '' as extra from DepartmentMaster", inferred:true },
  SubCategoryMaster:{ id:'SCMId', name:'SCMName', sql:"select SCMId as id, SCMName as name, '' as extra from SubCategoryMaster", inferred:true },
  StyleMaster:      { id:'StyleId', name:'StyleName', sql:"select StyleId as id, StyleName as name, '' as extra from StyleMaster", inferred:true },
  DesignMaster:     { id:'DesId', name:'DesName', sql:"select DesId as id, DesName as name, '' as extra from DesignMaster", inferred:true },
  SizeMaster:       { id:'SizeId', name:'SizeOfDress', sql:"select SizeId as id, SizeOfDress as name, '' as extra from SizeMaster", inferred:true },
  ColorMaster:      { id:'ColorId', name:'ColorName', sql:"select ColorId as id, ColorName as name, '' as extra from ColorMaster", inferred:true },
  BrandMaster:      { id:'BrandId', name:'BrandName', sql:"select BrandId as id, BrandName as name, '' as extra from BrandMaster", inferred:true },
};

const RC_EXTRACT_SQL = `
select '' as SlNo, (Case when A.OEMCode <> '' Then A.OEMCode else A.Itemcode end) as OEMCode, Upper(A.Itemdesc) as ItemDescription,
  A.CurQty as Qty, A.Prate as PurchasePrice, F.MRP as MRP, F.dis_value as Discount, F.dis_type as DisType, F.S_std_Price as DiscountPrice,
  Upper(DivName) as Division, Upper(SDMName) as Department, Upper(A.CatName) as Category, Upper(A.SCMName) as SubCategory,
  Upper(A.StyleName) as Style, Upper(A.DesName) as Design, Upper(A.SizeOfDress) as Size, Upper(A.ColorName) as Color, Upper(A.BrandName) as Brand,
  A.HSNCOde as Verticle1, Upper(A.Verticle2) as Verticle2, Upper(A.Verticle3) as Verticle3,
  D.Tax_per as InTax, D.Tax_Type_Inc_Exl as InTaxtype, E.Tax_per as OutTax, E.Tax_Type_Inc_Exl as OutTaxtype,
  '' as BatchNo, '' as PackedDate, '' as ExpiryDate, Upper(A.PartyName) as SupplierName,
  '0' as [Purchase Discount], 'A' as [Purchase Discount Type], A.HSNCOde as HSNCODE, '' as WSP
from Itemproperties A
  Inner Join Itemmaster B   on A.Itemcode = B.Itemcode
  Inner Join Price_Master C on A.Itemcode = C.Itemcode
  Inner Join Tax_Master D   on C.Desc3 = D.Tax_uid
  Inner Join Tax_Master E   on A.Tax_Uid = E.Tax_Uid
  Inner Join Price_Master F on F.Itemcode = A.Itemcode and A.status = 'A'`;

const wrap = fn => (req, res) => fn(req, res).catch(err => { console.error(err); res.status(500).json({ error: err.message }); });

/* ---------- health / schema / masters ---------- */
router.get('/health', wrap(async (req, res) => {
  const out = { ok: true, server: process.env.SQL_SERVER, dbNew: process.env.DB_NEW, dbOld: process.env.DB_OLD, compId: COMP, postMode: process.env.POST_MODE || 'LEGACY', chunkSize: Number(process.env.CHUNK_SIZE || 50000) };
  try { const r = await query('new', "select db_name() as db, @@version as v, (select count(*) from sys.procedures where name like 'proc_Import_%') as frameworkProcs"); Object.assign(out, { connected: true, version: r.recordset[0].v.split('\n')[0], frameworkProcs: r.recordset[0].frameworkProcs }); }
  catch (e) { Object.assign(out, { connected: false, error: e.message }); }
  try { await query('old', 'select 1'); out.oldConnected = true; } catch (e) { out.oldConnected = false; out.oldError = e.message; }
  res.json(out);
}));

router.get('/schema', wrap(async (req, res) => {
  const r = await query('new', `
    SELECT o.name AS table_name, CASE o.type WHEN 'V' THEN 'view' WHEN 'P' THEN 'proc' ELSE 'table' END AS kind,
           c.name AS column_name, ty.name + CASE WHEN ty.name IN ('varchar','nvarchar','char','nchar') THEN '(' + CASE WHEN c.max_length=-1 THEN 'max' ELSE CONVERT(varchar(10), c.max_length / CASE WHEN ty.name LIKE 'n%' THEN 2 ELSE 1 END) END + ')' ELSE '' END AS data_type,
           c.is_nullable, c.column_id,
           fk.referenced = OBJECT_NAME(fkc.referenced_object_id), fk.referenced_column = COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id)
    FROM sys.objects o JOIN sys.columns c ON c.object_id = o.object_id JOIN sys.types ty ON ty.user_type_id = c.user_type_id
    LEFT JOIN sys.foreign_key_columns fkc ON fkc.parent_object_id = c.object_id AND fkc.parent_column_id = c.column_id
    WHERE o.name IN ('Itemmaster','Price_Master','Invtransaction','Stock_Import_Export','vendormaster','CustomerMaster','Itemproperties','ImportBatch','ImportBatchChunk','ImportBatchTrace',
                     'CategoryMaster','UOMMaster','Tax_Master','M_GeneralLedger','CounterMaster','BranchMaster','DivisionMaster','DepartmentMaster','SubCategoryMaster','StyleMaster','DesignMaster','SizeMaster','ColorMaster','BrandMaster')
    ORDER BY o.name, c.column_id`);
  const params = await query('new', `SELECT OBJECT_NAME(p.object_id) AS proc_name, p.name AS param, TYPE_NAME(p.user_type_id) AS data_type, p.is_output FROM sys.parameters p WHERE OBJECT_NAME(p.object_id) IN ('proc_StockImportwithSupplier','sp_englishHBS','proc_Import_Begin','proc_Import_Post','proc_Import_Rollback') ORDER BY 1, p.parameter_id`);
  const tables = {};
  for (const row of r.recordset) { (tables[row.table_name] = tables[row.table_name] || { name: row.table_name, kind: row.kind, cols: [] }).cols.push({ key: row.column_name, sql: row.data_type, nullable: row.is_nullable, fk: row.referenced ? `${row.referenced}.${row.referenced_column}` : null }); }
  for (const p of params.recordset) { (tables[p.proc_name] = tables[p.proc_name] || { name: p.proc_name, kind: 'proc', cols: [] }).cols.push({ key: p.param, sql: p.data_type + (p.is_output ? ' output' : '') }); }
  res.json({ objects: Object.values(tables) });
}));

router.get('/masters', wrap(async (req, res) => {
  const out = {}; const errors = {};
  await Promise.all(Object.entries(MASTER_SQL).map(async ([t, m]) => {
    try { const r = await query('new', m.sql); out[t] = { id: m.id, name: m.name, inferred: !!m.inferred, rows: r.recordset.map(x => [String(x.id ?? x[m.id] ?? ''), String(x.name ?? x[m.name] ?? ''), String(x.extra ?? '')]) }; }
    catch (e) { errors[t] = e.message; out[t] = { id: m.id, name: m.name, inferred: true, rows: [], error: e.message }; }
  }));
  res.json({ masters: out, errors });
}));

/* ---------- source: file upload (server-side parse) and RetailCLIQ → RetailCLIQ ---------- */
router.post('/upload', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const parsed = await parseBuffer(req.file.buffer, req.file.originalname);
  res.json({ name: req.file.originalname, size: req.file.size, ...parsed });
}));

router.post('/rc/extract', wrap(async (req, res) => {
  const { compId = COMP, branchId = '', zero = 'skip', status = 'A', top = 0 } = req.body || {};
  let text = RC_EXTRACT_SQL;
  if (status !== 'A') text = text.replace("and A.status = 'A'", '');
  const where = [];
  // CompId / BranchId columns on Itemproperties are not confirmed — pass as optional filters only when given
  if (branchId) where.push(`A.BranchId = @branchId`);
  if (zero === 'skip') where.push('A.CurQty <> 0');
  if (where.length) text += ' where ' + where.join(' and ');
  if (top) text = text.replace('select \'\' as SlNo', `select top ${Number(top)} '' as SlNo`);
  const p = await pool('old'); const rq = p.request().input('branchId', branchId);
  const r = await rq.query(text);
  const columns = r.recordset.columns ? Object.keys(r.recordset.columns) : Object.keys(r.recordset[0] || {});
  const rows = r.recordset.map(row => columns.map(c => row[c] == null ? '' : (row[c] instanceof Date ? row[c].toISOString().slice(0, 10) : String(row[c]))));
  res.json({ name: `${process.env.DB_OLD}.Itemproperties`, columns, rows, sql: text });
}));

/* ---------- import batch lifecycle (framework procs) ---------- */
router.post('/import/begin', wrap(async (req, res) => {
  const b = req.body || {};
  const p = await pool('new');
  const r = await p.request()
    .input('ImportType', sql.VarChar(30), b.importType || 'STOCK').input('CompId', sql.VarChar(10), b.compId || COMP)
    .input('BranchId', sql.VarChar(20), b.branchId).input('UserId', sql.VarChar(20), b.userId || process.env.DEFAULT_USER || 'U10001')
    .input('SourceName', sql.NVarChar(260), b.source || null).input('PostMode', sql.VarChar(10), b.postMode || process.env.POST_MODE || 'LEGACY')
    .input('PurchaseAccount', sql.VarChar(20), b.purchaseAccount || null).input('DateOrder', sql.Char(3), b.dateOrder || 'DMY')
    .input('NumberStyle', sql.VarChar(5), b.numberStyle || 'DOT').input('Region', sql.VarChar(10), b.region || 'en-IN')
    .input('DupKeyColumns', sql.VarChar(200), b.dupKeyColumns || 'OEMCode').input('DupMode', sql.VarChar(5), (b.dupMode || 'ERROR').toUpperCase())
    .input('DbMode', sql.VarChar(10), (b.dbMode || 'RUNNING').toUpperCase()).input('ChunkSize', sql.Int, Number(b.chunkSize || process.env.CHUNK_SIZE || 50000))
    .input('Remarks', sql.NVarChar(500), b.remarks || null).output('BatchId', sql.VarChar(30))
    .execute('proc_Import_Begin');
  res.json({ batchId: r.output.BatchId });
}));

/* rows: [{SlNo:'1', OEMCode:'..', ...}] already resolved by the wizard (mapping + defaults + master choices). Bulk-inserted with BatchId/RowNo. */
router.post('/import/:batchId/rows', wrap(async (req, res) => {
  const { batchId } = req.params; const { rows = [], startRow = 1 } = req.body || {};
  const p = await pool('new');
  const meta = await p.request().query(`select c.name, t.name as type, c.max_length from sys.columns c join sys.types t on t.user_type_id=c.user_type_id where c.object_id=object_id('dbo.Stock_Import_Export')`);
  const have = new Map(meta.recordset.map(m => [m.name.toLowerCase(), m]));
  const table = new sql.Table('dbo.Stock_Import_Export'); table.create = false;
  const cols = [...STAGING_COLS, ...EXTRA_COLS].filter(c => have.has(c.toLowerCase()));
  for (const c of cols) { const m = have.get(c.toLowerCase()); table.columns.add(m.name, m.type.startsWith('n') ? sql.NVarChar(m.max_length === -1 ? sql.MAX : m.max_length / 2) : sql.VarChar(m.max_length === -1 ? sql.MAX : m.max_length), { nullable: true }); }
  table.columns.add('BatchId', sql.VarChar(30), { nullable: true }); table.columns.add('RowNo', sql.Int, { nullable: true }); table.columns.add('RowStatus', sql.Char(1), { nullable: false });
  rows.forEach((r, i) => table.rows.add(...cols.map(c => { const v = r[c]; return v == null ? '' : String(v); }), batchId, startRow + i, 'P'));
  const result = await p.request().bulk(table);
  res.json({ inserted: result.rowsAffected, nextRow: startRow + rows.length });
}));

router.post('/import/:batchId/validate', wrap(async (req, res) => {
  const p = await pool('new');
  const r = await p.request().input('BatchId', sql.VarChar(30), req.params.batchId).execute('proc_Import_Validate');
  res.json(r.recordset[0]);
}));

router.post('/import/:batchId/gate', wrap(async (req, res) => {
  const p = await pool('new');
  const r = await p.request().input('BatchId', sql.VarChar(30), req.params.batchId).input('AllowErrors', sql.Bit, req.body?.allowErrors ? 1 : 0).execute('proc_Import_Gate');
  res.json({ checks: r.recordsets[0], gate: r.recordsets[1][0] });
}));
router.get('/prereq', wrap(async (req, res) => {
  const p = await pool('new');
  const r = await p.request().input('PurchaseAccount', sql.VarChar(20), req.query.purchaseAccount || null).execute('proc_Import_CheckPrerequisites');
  res.json(r.recordset);
}));
router.get('/phase2', wrap(async (req, res) => { const p = await pool('new'); const r = await p.request().execute('proc_Import_Phase2'); res.json(r.recordset); }));
router.post('/phase2/:id', wrap(async (req, res) => {
  const p = await pool('new');
  const r = await p.request().input('Id', sql.Int, Number(req.params.id)).input('Status', sql.VarChar(12), req.body.status).input('Owner', sql.VarChar(40), req.body.owner || null).execute('proc_Import_Phase2');
  res.json(r.recordset);
}));

const jobs = new Map();   // batchId -> { running, error }
router.post('/import/:batchId/post', wrap(async (req, res) => {
  const { batchId } = req.params;
  if (jobs.get(batchId)?.running) return res.json({ started: false, reason: 'already running' });
  const gp = await pool('new');
  const g = await gp.request().input('BatchId', sql.VarChar(30), batchId).input('AllowErrors', sql.Bit, req.body?.allowErrors ? 1 : 0).execute('proc_Import_Gate');
  if (!g.recordsets[1][0].GatePassed) return res.status(409).json({ started: false, reason: 'final gate failed', checks: g.recordsets[0].filter(c => c.Result === 'FAIL') });
  jobs.set(batchId, { running: true });
  (async () => {   // background: post in slices of 2 chunks so status is refreshed between calls
    try {
      for (;;) {
        const p = await pool('new');
        const r = await p.request().input('BatchId', sql.VarChar(30), batchId).input('MaxChunks', sql.Int, 2).execute('proc_Import_Post');
        const status = r.recordsets[0][0]?.Status;
        if (!['Posting', 'Validated'].includes(status)) break;
      }
      jobs.set(batchId, { running: false });
    } catch (e) { jobs.set(batchId, { running: false, error: e.message }); }
  })();
  res.json({ started: true });
}));

router.get('/import/:batchId/status', wrap(async (req, res) => {
  const p = await pool('new');
  const r = await p.request().input('BatchId', sql.VarChar(30), req.params.batchId).execute('proc_Import_Status');
  res.json({ batch: r.recordsets[0][0] || null, chunks: r.recordsets[1] || [], job: jobs.get(req.params.batchId) || null });
}));
router.post('/import/:batchId/cancel', wrap(async (req, res) => {
  await query('new', 'exec proc_Import_Cancel @b, @u', { b: req.params.batchId, u: req.body?.userId || process.env.DEFAULT_USER || 'U10001' });
  res.json({ ok: true });
}));
router.post('/import/:batchId/resume', wrap(async (req, res) => { req.url = `/import/${req.params.batchId}/post`; router.handle(req, res); }));
router.post('/import/:batchId/rollback', wrap(async (req, res) => {
  const p = await pool('new');
  const r = await p.request().input('BatchId', sql.VarChar(30), req.params.batchId).input('UserId', sql.VarChar(20), req.body?.userId || process.env.DEFAULT_USER || 'U10001')
    .input('Reason', sql.NVarChar(500), req.body?.reason || null).input('FromChunk', sql.Int, Number(req.body?.fromChunk || 1)).execute('proc_Import_Rollback');
  res.json({ batch: r.recordsets[0][0], chunks: r.recordsets[1] });
}));
router.get('/import/:batchId/errors', wrap(async (req, res) => {
  const r = await query('new', `select RowNo, RowStatus, ErrorMsg, ${[...STAGING_COLS].map(c => `[${c}]`).join(',')} from Stock_Import_Export where BatchId=@b and RowStatus in ('E','W') order by RowNo`, { b: req.params.batchId });
  const cols = Object.keys(r.recordset[0] || { RowNo: 1, RowStatus: 1, ErrorMsg: 1 });
  const csv = [cols.join(',')].concat(r.recordset.map(row => cols.map(c => `"${String(row[c] ?? '').replace(/"/g, '""')}"`).join(','))).join('\n');
  res.setHeader('Content-Type', 'text/csv'); res.setHeader('Content-Disposition', `attachment; filename="${req.params.batchId}_errors.csv"`); res.send(csv);
}));
router.get('/import', wrap(async (req, res) => {
  const r = await query('new', 'select top 50 BatchId, ImportType, Status, TotalRows, RowsValid, RowsError, RowsPosted, StartedAt, EndedAt, UserId, SourceName, MRNo, LastError from ImportBatch order by StartedAt desc');
  res.json(r.recordset);
}));

module.exports = router;
