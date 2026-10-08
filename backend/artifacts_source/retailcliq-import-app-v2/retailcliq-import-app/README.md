# RetailCLIQ Universal Import

9-step import wizard (Source → Preview → Mapping → Suppliers → Master mapping → Validation → Confirm → Import → Result) with a Node/Express/MSSQL service that stages, validates, posts and reconciles imports in resumable, reversible chunks.

```
public/index.html            the wizard (works standalone in demo mode; goes live when served by this server)
server/index.js              Express app  (serves /public and /api)
server/routes/api.js         health, schema, masters, upload, rc/extract, import lifecycle
server/lib/db.js             mssql pools for DB_NEW (target) and DB_OLD (source)
sql/01_batch_framework.sql   ImportBatch / ImportBatchChunk / ImportBatchTrace + proc_Import_* procs + HBS functions
scripts/check-db.js          connectivity + object inventory + column lists (answers the VERIFY markers)
scripts/deploy-sql.js        runs a .sql file in GO batches against DB_NEW
scripts/smoke-test.js        3-row end-to-end test: begin → bulk → validate (→ post → rollback with --post)
```

## 1. Setup (on a machine that can reach 120.138.9.33,58842)

```bash
npm install
copy .env.example .env      # Windows   (cp on Linux/macOS)
# edit .env: SQL_USER / SQL_PASSWORD, DB_NEW=SMART_NEWDB, DB_OLD=SMARTSM_OLDDB
npm run db:check            # must show ✓ for Itemmaster, Price_Master, Invtransaction, Itemproperties, Stock_Import_Export, proc_StockImportwithSupplier …
```

`db:check` prints the real column lists of `Invtransaction`, `Itemmaster`, `Price_Master`, `vendormaster`, `M_GeneralLedger`, `Stock_Import_Export`.
Use them to close the `VERIFY` markers in `sql/01_batch_framework.sql` (search "VERIFY", 9 places — mostly the `Invtransaction` row key and the column lists in the rollback restore).

## 2. Deploy the batch framework into SMART_NEWDB

```bash
npm run db:deploy           # re-runnable; prints the proc_Import_* procs created
npm run db:smoke            # stages 3 rows and validates them (row 3 must come back as an error)
npm run db:smoke -- --post BMS10001 24-HB0001   # also posts through proc_StockImportwithSupplier and rolls back
```

Nothing in the framework modifies `proc_StockImportwithSupplier`; it is called per chunk inside a transaction.

## 3. Run

```bash
npm start                   # http://localhost:3000
```

The header pill shows `live · SMART_NEWDB` when connected (masters, branches, purchase accounts and the schema panel are then loaded from the database). With no DB it shows `offline demo` and uses embedded sample data.

## 4. Test plan

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 1 | Excel/CSV opening stock, fresh DB | Source → Upload file → Target DB = Fresh → Mapping (Apply standard defaults for missing columns) → Suppliers: upload supplier file → Master mapping: Keep matched, create the rest → Validation (Apparel profile) → Confirm → Start | Batch reaches **Reconciled**; `select * from ImportBatch` shows RowsPosted = valid rows; `ImportBatchTrace` lists every created row |
| 2 | Interruption | Start a batch with chunk size 5000 on ≥ 20 000 rows; kill `node` (or the SQL connection) mid-way | `ImportBatchChunk`: committed chunks stay `Committed`, the open one is `Posting`/`Pending`. Restart server, `POST /api/import/<id>/resume` (or run `exec proc_Import_Resume '<id>'`) → continues from that chunk, ends Reconciled |
| 3 | Cancel | Click Cancel during posting | Stops at next chunk boundary, Status `Cancelled`; committed chunks remain; Result page offers Rollback |
| 4 | Rollback | Result → Rollback this batch → type ROLLBACK | `Invtransaction` rows of the batch deleted, inserted items/prices/vendors removed, updated rows restored from before-image; Status `RolledBack`; staging rows back to `V` |
| 5 | Reconciliation failure | Manually delete one `Invtransaction` row of a posted batch, then `exec proc_Import_Reconcile '<id>'` | Status `Failed`, LastError shows the row/qty/value mismatch |
| 6 | RetailCLIQ → RetailCLIQ | Source = RetailCLIQ → RetailCLIQ → Connect & fetch (reads `Itemproperties` in SMARTSM_OLDDB) → defaults auto-applied → masters copied as-is | Items and masters from the old DB land in SMART_NEWDB |
| 7 | Concurrency | Start the same batch's post from two terminals | Second call fails with "already being posted by another worker" |
| 8 | Duplicate OEM (apparel) | Shoper sample, Industry profile = Apparel vs Generic | Apparel: same OEM in M/L/XL passes; Generic: rejected as duplicates |

## 5. API

| Method | Path | Purpose |
|---|---|---|
| GET | /api/health | connectivity, framework deployed? |
| GET | /api/schema | live columns + FKs for the mapping panel |
| GET | /api/masters | all master lookups (legacy form queries) |
| POST | /api/upload | multipart file → columns/rows (CSV, TSV, XLSX) |
| POST | /api/rc/extract | run the Itemproperties extraction on DB_OLD |
| POST | /api/import/begin | proc_Import_Begin → batchId |
| POST | /api/import/:id/rows | bulk insert resolved rows (5 000 per call from the UI) |
| POST | /api/import/:id/validate | proc_Import_Validate |
| POST | /api/import/:id/post | background proc_Import_Post loop |
| GET | /api/import/:id/status | proc_Import_Status (progress bar) |
| POST | /api/import/:id/cancel · /resume · /rollback | proc_Import_Cancel / Post / Rollback |
| GET | /api/import/:id/errors | CSV of rows with errors/warnings |
| GET | /api/import | last 50 batches |

## 5b. Legacy parity, final gate and Phase 2

`proc_Import_Validate` now matches `frmOpeningStockwithSupplier`: HSN auto-fill from `CategoryMaster.HSNCode`, blank UOMId = warning, blank TransDate = today.
`proc_Import_CheckPrerequisites` runs the form's pre-flight checks (UOMMaster / Tax_GroupMaster / Barcodedef / purchase account / proc exists / staging columns).
`proc_Import_Gate` (`POST /api/import/:id/gate`) is the final validation: row accounting, pending rows, error policy, chunk plan, duplicate ItemCode, pre-flight. `proc_Import_Post` and `POST /post` refuse to run until it passes.
Items that depend on the tenant DB are tracked in `ImportPhase2Item` (`GET /api/phase2`, `POST /api/phase2/:id {status,owner}`; or `exec proc_Import_Phase2`). Open items are listed on every gate run as PHASE2.
With `LegacyReuse=1` (default) the post step sends Fabric←ExpiryDate, ArtName←ItemDescription, TransNo←BatchNo, TransDate←PackedDate exactly like the legacy form.

## 6. Known gaps (next iteration)

- Row resolution (mapping, defaults, article name, master choices) runs in the browser and is sent in 5 000-row slices. For > 1 M rows move that engine server-side (same JS, loaded by Node) so the browser only uploads the file + the mapping template.
- Supplier creation + `M_GeneralLedger` opening balances are shown in the plan but not yet executed by the API: needs your vendor-insert procedure name and the ledger column list (`db:check` prints `M_GeneralLedger`).
- `POST_MODE=NATIVE` (set-based posting without the legacy proc) is a stub until the `Invtransaction` / `Itemmaster` / `Price_Master` columns are confirmed.
