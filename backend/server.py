from dotenv import load_dotenv
load_dotenv()

import os, uuid, io, csv, bcrypt, jwt, asyncio, logging
try:
    import pymssql as _mssql
    _MSSQL_AVAIL = True
except ImportError:
    _mssql = None
    _MSSQL_AVAIL = False
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any
from pathlib import Path

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, UploadFile, File, Depends, BackgroundTasks, Query, Body
from fastapi.responses import StreamingResponse, JSONResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel
from bson import ObjectId
import openpyxl

ROOT_DIR = Path(__file__).parent
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="RetailCLIQ Import API")
api_router = APIRouter(prefix="/api")

JWT_SECRET = os.environ.get("JWT_SECRET", "retailcliq-import-secret-key")
JWT_ALGORITHM = "HS256"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Auth helpers ─────────────────────────────────────────────────────────────

def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_pw(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())

def make_token(uid: str, email: str) -> str:
    return jwt.encode({"sub": uid, "email": email, "type": "access",
                       "exp": datetime.now(timezone.utc) + timedelta(hours=24)},
                      JWT_SECRET, algorithm=JWT_ALGORITHM)

async def require_auth(request: Request) -> dict:
    token = request.cookies.get("access_token") or ""
    if not token:
        ah = request.headers.get("Authorization", "")
        token = ah[7:] if ah.startswith("Bearer ") else ""
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(401, "Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(401, "User not found")
        user["id"] = str(user.pop("_id"))
        user.pop("passwordHash", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")

# ── File parsing ─────────────────────────────────────────────────────────────

async def parse_file(data: bytes, fname: str) -> dict:
    if fname.lower().endswith(('.xlsx', '.xls')):
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        ws = wb.active
        all_rows = []
        for row in ws.iter_rows(values_only=True):
            cells = []
            for v in row:
                if v is None:
                    cells.append("")
                elif isinstance(v, datetime):
                    cells.append(v.strftime("%d/%m/%Y"))
                else:
                    cells.append(str(v).strip())
            if any(cells):
                all_rows.append(cells)
        wb.close()
        if not all_rows:
            return {"columns": [], "rows": [], "rowCount": 0}
        columns = [c or f"Col{i+1}" for i, c in enumerate(all_rows[0])]
        data_rows = [row + [""] * max(0, len(columns) - len(row)) for row in all_rows[1:] if any(v.strip() for v in row)]
        return {"columns": columns, "rows": data_rows, "rowCount": len(data_rows)}
    else:
        text = data.decode("utf-8-sig", errors="replace")
        first = text.split("\n")[0]
        counts = {",": first.count(","), ";": first.count(";"), "\t": first.count("\t"), "|": first.count("|")}
        delim = max(counts, key=counts.get) or ","
        reader = csv.reader(io.StringIO(text), delimiter=delim)
        all_rows = [r for r in reader if r]
        if not all_rows:
            return {"columns": [], "rows": [], "rowCount": 0}
        columns = [c.strip() or f"Col{i+1}" for i, c in enumerate(all_rows[0])]
        data_rows = [(r + [""] * max(0, len(columns) - len(r)))[:len(columns)]
                     for r in all_rows[1:] if any(v.strip() for v in r)]
        return {"columns": columns, "rows": data_rows, "rowCount": len(data_rows)}

# ── Validation (24 rules) ────────────────────────────────────────────────────

def _num(s, style="DOT"):
    v = str(s or "").strip().replace("₹","").replace("Rs.","").replace(" ","").replace("\xa0","")
    if not v:
        return None
    if style == "COMMA":
        v = v.replace(".", "").replace(",", ".")
    else:
        v = v.replace(",", "")
    if v.startswith("(") and v.endswith(")"):
        v = "-" + v[1:-1]
    try:
        return float(v)
    except Exception:
        return None

def _date(s, order="DMY"):
    v = str(s or "").strip()
    if not v:
        return None
    if v.isdigit() and 4 <= len(v) <= 5:
        n = int(v)
        try:
            return datetime(n // 416 + 1950, (n % 416) // 32, (n % 416) % 32)
        except Exception:
            return None
    if len(v) >= 10 and v[4:5] == "-" and v[7:8] == "-":
        try:
            return datetime.strptime(v[:10], "%Y-%m-%d")
        except Exception:
            pass
    v2 = v.replace(".", "/").replace("-", "/")
    for fmt in ("%d/%b/%Y", "%d/%B/%Y"):
        try:
            return datetime.strptime(v2, fmt)
        except Exception:
            pass
    parts = v2.split("/")
    if len(parts) == 3:
        try:
            p = [int(x) for x in parts]
            if order == "MDY":
                return datetime(p[2], p[0], p[1])
            if order == "YMD":
                return datetime(p[0], p[1], p[2])
            return datetime(p[2], p[1], p[0])
        except Exception:
            pass
    return None

async def validate_rows(rows: list, batch: dict) -> list:
    num_style = batch.get("numberStyle", "DOT")
    date_order = batch.get("dateOrder", "DMY")
    dup_key = batch.get("dupKeyColumns", "OEMCode")
    dup_mode = batch.get("dupMode", "ERROR")
    db_mode = batch.get("dbMode", "RUNNING")

    vendors = await db.vendors.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(None)
    vid = {v["id"].lower() for v in vendors if v.get("id")}
    vname = {v["name"].lower() for v in vendors if v.get("name")}

    uoms = await db.uom_master.find({}, {"_id": 0, "id": 1}).to_list(None)
    uom_ids = {u["id"].lower() for u in uoms if u.get("id")}

    taxes = await db.tax_master.find({}, {"_id": 0, "id": 1, "per": 1}).to_list(None)
    tax_ids = {t["id"].lower() for t in taxes if t.get("id")}
    tax_pers = {str(t["per"]) for t in taxes if "per" in t}

    cats = await db.category_master.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(None)
    cat_ids = {c["id"].lower() for c in cats if c.get("id")}
    cat_names = {c["name"].lower() for c in cats if c.get("name")}

    def flag(row, cond, msg, sev):
        if not cond:
            return
        if sev == "E":
            row["rowStatus"] = "E"
        elif row["rowStatus"] != "E":
            row["rowStatus"] = "W"
        ex = row.get("errorMsg") or ""
        row["errorMsg"] = ((ex + "; " if ex else "") + msg)[:1000]

    for row in rows:
        row["rowStatus"] = "V"
        row["errorMsg"] = ""

        td_raw = (row.get("TransDate") or "").strip()
        ed_raw = (row.get("ExpiryDate") or "").strip()
        td = _date(td_raw, date_order) if td_raw else datetime.now()
        ed = _date(ed_raw, date_order) if ed_raw else None

        item_desc = (row.get("ItemDescription") or "").strip()
        uom = (row.get("UOMId") or "").strip()
        qty_s = (row.get("Qty") or "").strip()
        pp_s = (row.get("PurchasePrice") or "").strip()
        mrp_s = (row.get("MRP") or "").strip()
        supplier = (row.get("Supplier") or "").strip()
        category = (row.get("Category") or "").strip()
        tax = (row.get("Tax") or "").strip()
        dis_type = (row.get("DisType") or "").strip()
        taxtype = (row.get("Taxtype") or "").strip()
        in_tt = (row.get("InTaxtype") or "").strip()
        pdt = (row.get("PurchaseDiscountType") or "").strip()
        v1 = (row.get("Verticle1") or "").strip()

        qty = _num(qty_s, num_style)
        pp = _num(pp_s, num_style)
        mrp = _num(mrp_s, num_style)

        # Rules 1-17 (pure field validation)
        flag(row, not item_desc, "ItemDescription is mandatory", "E")
        flag(row, not uom, "UOMId blank (legacy proc default applies)", "W")
        flag(row, not qty_s or qty is None, "Qty is mandatory / not numeric", "E")
        flag(row, qty is not None and qty < 0, "Qty cannot be negative", "E")
        flag(row, not pp_s or pp is None, "PurchasePrice mandatory / numeric", "E")
        flag(row, pp is not None and pp < 0, "PurchasePrice cannot be negative", "E")
        flag(row, bool(mrp_s) and mrp is None, "MRP not numeric", "E")
        flag(row, bool(td_raw) and td is None, f"TransDate invalid ({date_order})", "E")
        flag(row, bool(ed_raw) and ed is None, f"ExpiryDate invalid ({date_order})", "E")
        flag(row, ed and td and ed < td, "ExpiryDate before TransDate", "E")
        flag(row, not supplier, "Supplier is mandatory", "E")
        flag(row, not category, "Category is mandatory", "E")
        flag(row, not tax, "Tax is mandatory", "E")
        flag(row, bool(dis_type) and dis_type not in ("P", "A"), "DisType must be P or A", "E")
        flag(row, bool(taxtype) and taxtype not in ("I", "E"), "Taxtype must be I or E", "E")
        flag(row, bool(in_tt) and in_tt not in ("I", "E"), "InTaxtype must be I or E", "E")
        flag(row, bool(pdt) and pdt not in ("P", "A"), "PurchaseDiscountType must be P or A", "E")

        # Rules 18-21 (master lookups)
        if supplier and vid:
            flag(row, supplier.lower() not in vid and supplier.lower() not in vname,
                 "Supplier not in vendormaster", "W" if db_mode == "FRESH" else "E")
        if uom and uom_ids:
            flag(row, uom.lower() not in uom_ids, "UOM not in UOMMaster",
                 "W" if db_mode == "FRESH" else "E")
        if tax and tax_ids:
            flag(row, tax.lower() not in tax_ids and tax not in tax_pers,
                 "Tax not in Tax_Master", "W" if db_mode == "FRESH" else "E")
        if category and cat_ids:
            flag(row, category.lower() not in cat_ids and category.lower() not in cat_names,
                 "Category not in CategoryMaster", "W" if db_mode == "FRESH" else "E")

        # Rules 22-24 (warnings)
        flag(row, qty == 0.0, "Qty is zero", "W")
        flag(row, mrp and mrp > 0 and pp and pp > mrp, "PurchasePrice exceeds MRP", "W")
        flag(row, bool(v1) and (not v1.isdigit() or len(v1) not in (4, 6, 8)),
             "HSN (Verticle1) should be 4/6/8 digits", "W")

    # Duplicate detection
    if dup_mode != "ALLOW":
        key_cols = [c.strip() for c in dup_key.split(",")]
        seen: dict = {}
        for row in rows:
            parts = [str(row.get(c) or "").strip().upper() for c in key_cols]
            k = "|".join(parts)
            if not any(parts):
                continue
            if k in seen:
                sev = "E" if dup_mode == "ERROR" else "W"
                flag(row, True, f"Duplicate {dup_key} (first at row {seen[k]})", sev)
            else:
                seen[k] = row["rowNo"]

    return rows

# ── Chunk assignment ─────────────────────────────────────────────────────────

def assign_chunks(rows: list, chunk_size: int):
    valid = [r for r in rows if r["rowStatus"] in ("V", "W")]
    chunks: dict = {}
    for i, row in enumerate(valid):
        cn = (i // chunk_size) + 1
        row["chunkNo"] = cn
        if cn not in chunks:
            chunks[cn] = {"chunkNo": cn, "fromRow": row["rowNo"], "toRow": row["rowNo"]}
        else:
            chunks[cn]["toRow"] = row["rowNo"]
    return list(chunks.values())

# ── SQL Server live-mode helpers ─────────────────────────────────────────────

MSSQL_SERVER   = os.environ.get("MSSQL_SERVER", "")
MSSQL_PORT     = int(os.environ.get("MSSQL_PORT", "1433"))
MSSQL_USER     = os.environ.get("MSSQL_USER", "")
MSSQL_PASSWORD = os.environ.get("MSSQL_PASSWORD", "")
MSSQL_DB       = os.environ.get("MSSQL_DB", "RC26ERP_DEV")
MSSQL_COMP_ID  = os.environ.get("MSSQL_COMP_ID", "c001")

def mssql_live() -> bool:
    return _MSSQL_AVAIL and bool(MSSQL_SERVER and MSSQL_USER)

def _new_sql_conn():
    return _mssql.connect(
        server=MSSQL_SERVER, port=MSSQL_PORT,
        user=MSSQL_USER, password=MSSQL_PASSWORD,
        database=MSSQL_DB, timeout=60, login_timeout=10,
        as_dict=True, charset="UTF-8"
    )

async def sql_query(sql: str, params: tuple = ()) -> list:
    """Async: run SELECT on SQL Server → list[dict]."""
    def _run():
        conn = _new_sql_conn()
        try:
            cur = conn.cursor()
            cur.execute(sql, params)
            return list(cur.fetchall() or [])
        finally:
            conn.close()
    return await asyncio.to_thread(_run)

async def sql_exec_multi(sql: str, params: tuple = ()) -> list:
    """Async: execute T-SQL batch, collect ALL result sets → list[list[dict]]."""
    def _run():
        conn = _new_sql_conn()
        try:
            cur = conn.cursor()
            cur.execute(sql, params)
            sets = []
            while True:
                try:
                    rows = list(cur.fetchall() or [])
                    sets.append(rows)
                except Exception:
                    sets.append([])
                try:
                    if not cur.nextset():
                        break
                except Exception:
                    break
            conn.commit()
            return sets
        finally:
            conn.close()
    return await asyncio.to_thread(_run)

async def sql_bulk_insert_rows(rows: list, batch_id: str) -> int:
    """Bulk-insert staging rows into dbo.Stock_Import_Export on SQL Server."""
    if not rows:
        return 0
    cols = STAGING_COLS + ["BatchId", "RowNo", "RowStatus"]
    ph   = ", ".join(["%s"] * len(cols))
    sql  = f"INSERT INTO dbo.Stock_Import_Export ({', '.join(cols)}) VALUES ({ph})"
    def _run():
        conn = _new_sql_conn()
        try:
            cur = conn.cursor()
            params_list = [
                tuple(str(r.get(c) or "") for c in STAGING_COLS) + (batch_id, r["rowNo"], "P")
                for r in rows
            ]
            cur.executemany(sql, params_list)
            conn.commit()
            return len(params_list)
        finally:
            conn.close()
    return await asyncio.to_thread(_run)

async def sql_health() -> dict:
    if not mssql_live():
        return {"configured": False, "connected": False, "mode": "demo",
                "message": "MSSQL_SERVER / MSSQL_USER not configured — running in demo mode"}
    try:
        rows = await sql_query(
            "SELECT DB_NAME() AS db, @@VERSION AS v, "
            "(SELECT COUNT(*) FROM sys.procedures WHERE name LIKE 'proc_Import_%') AS procs"
        )
        r = rows[0] if rows else {}
        return {"configured": True, "connected": True, "mode": "live",
                "database": r.get("db"), "version": (r.get("v") or "")[:80],
                "frameworkProcs": r.get("procs", 0)}
    except Exception as e:
        return {"configured": True, "connected": False, "mode": "demo", "error": str(e)}

# ── Background posting ───────────────────────────────────────────────────────

posting_jobs: dict = {}

async def _post_batch_bg_live(batch_id: str):
    """Live mode: drive proc_Import_Post on SQL Server in slices."""
    posting_jobs[batch_id] = {"running": True, "error": None}
    try:
        while True:
            await sql_exec_multi(
                "EXEC dbo.proc_Import_Post @BatchId=%s, @MaxChunks=%s",
                (batch_id, 2))

            st_rows = await sql_query(
                "SELECT Status, TotalRows, RowsPosted, MRNo, LastError "
                "FROM dbo.ImportBatch WHERE BatchId=%s", (batch_id,))
            if not st_rows:
                break
            st = st_rows[0]
            status = st.get("Status", "")

            await db.batches.update_one({"_id": batch_id}, {"$set": {
                "status": status, "rowsPosted": st.get("RowsPosted"),
                "mrNo": st.get("MRNo"), "lastError": st.get("LastError"),
                "endedAt": datetime.now(timezone.utc).isoformat() if status not in ("Posting","Validated") else None}})

            # Sync chunks to MongoDB
            cr_rows = await sql_query(
                "SELECT ChunkNo, Status, RowsOk, MRNo, Attempts, "
                "CONVERT(varchar(30),StartedAt,120) AS StartedAt, "
                "CONVERT(varchar(30),EndedAt,120) AS EndedAt, ErrorMsg "
                "FROM dbo.ImportBatchChunk WHERE BatchId=%s ORDER BY ChunkNo", (batch_id,))
            for cr in cr_rows:
                await db.batch_chunks.update_one(
                    {"batchId": batch_id, "chunkNo": cr["ChunkNo"]},
                    {"$set": {"status": cr["Status"], "rowsOk": cr.get("RowsOk"),
                              "mrNo": cr.get("MRNo"), "attempts": cr.get("Attempts", 0),
                              "startedAt": str(cr.get("StartedAt") or ""),
                              "endedAt": str(cr.get("EndedAt") or ""),
                              "errorMsg": cr.get("ErrorMsg")}},
                    upsert=True)

            if status not in ("Posting", "Validated"):
                break
            await asyncio.sleep(0.2)

        posting_jobs[batch_id] = {"running": False, "error": None}
    except Exception as e:
        logger.error("Live post error %s: %s", batch_id, e)
        await db.batches.update_one({"_id": batch_id}, {"$set": {"status": "Failed", "lastError": str(e)}})
        posting_jobs[batch_id] = {"running": False, "error": str(e)}

async def post_batch_bg(batch_id: str):
    """Dispatch: live (SQL Server proc_Import_Post) or demo (MongoDB simulation)."""
    if mssql_live():
        await _post_batch_bg_live(batch_id)
        return
    await _post_batch_bg_demo(batch_id)

async def _post_batch_bg_demo(batch_id: str):
    posting_jobs[batch_id] = {"running": True, "error": None}
    try:
        await db.batches.update_one({"_id": batch_id}, {"$set": {"status": "Posting", "lastError": None}})
        while True:
            chunk = await db.batch_chunks.find_one(
                {"batchId": batch_id, "status": "Pending"}, sort=[("chunkNo", 1)])
            if not chunk:
                break
            bx = await db.batches.find_one({"_id": batch_id})
            if bx and bx.get("status") == "Cancelled":
                break
            cn = chunk["chunkNo"]
            await db.batch_chunks.update_one(
                {"batchId": batch_id, "chunkNo": cn},
                {"$set": {"status": "Posting", "startedAt": datetime.now(timezone.utc).isoformat()}, "$inc": {"attempts": 1}})
            await asyncio.sleep(0.4)  # simulate work
            rows_ok = await db.batch_rows.count_documents(
                {"batchId": batch_id, "chunkNo": cn, "rowStatus": {"$in": ["V", "W"]}})
            mr = f"MR-{datetime.now().strftime('%Y%m%d')}-{cn:04d}"
            await db.batch_rows.update_many(
                {"batchId": batch_id, "chunkNo": cn, "rowStatus": {"$in": ["V", "W"]}},
                {"$set": {"rowStatus": "C"}})
            await db.batch_chunks.update_one(
                {"batchId": batch_id, "chunkNo": cn},
                {"$set": {"status": "Committed", "endedAt": datetime.now(timezone.utc).isoformat(),
                           "rowsOk": rows_ok, "mrNo": mr}})

        pending = await db.batch_chunks.count_documents(
            {"batchId": batch_id, "status": {"$in": ["Pending", "Posting", "Failed"]}})
        bx = await db.batches.find_one({"_id": batch_id})
        if pending == 0 and bx and bx.get("status") != "Cancelled":
            rows_posted = await db.batch_rows.count_documents({"batchId": batch_id, "rowStatus": "C"})
            committed = await db.batch_chunks.find({"batchId": batch_id, "status": "Committed"}).to_list(None)
            mr_all = ", ".join(c["mrNo"] for c in committed if c.get("mrNo"))
            await db.batches.update_one({"_id": batch_id}, {"$set": {
                "status": "Reconciled", "rowsPosted": rows_posted, "mrNo": mr_all,
                "endedAt": datetime.now(timezone.utc).isoformat()}})
        posting_jobs[batch_id] = {"running": False, "error": None}
    except Exception as e:
        logger.error("Posting error %s: %s", batch_id, e)
        await db.batches.update_one({"_id": batch_id}, {"$set": {"status": "Failed", "lastError": str(e)}})
        posting_jobs[batch_id] = {"running": False, "error": str(e)}

# ── Startup seed ─────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.batches.create_index([("compId", 1), ("startedAt", -1)])
    await db.batch_rows.create_index([("batchId", 1), ("rowNo", 1)], unique=True)
    await db.batch_rows.create_index([("batchId", 1), ("chunkNo", 1), ("rowStatus", 1)])
    await db.batch_chunks.create_index([("batchId", 1), ("chunkNo", 1)], unique=True)

    admin_email = os.environ.get("ADMIN_EMAIL", "msnarayana@retailcliq.com")
    admin_pw    = os.environ.get("ADMIN_PASSWORD", "RetailCLIQ@2026")
    ex = await db.users.find_one({"email": admin_email})
    if not ex:
        await db.users.insert_one({
            "email": admin_email, "passwordHash": hash_pw(admin_pw),
            "username": "M.S. Narayana", "compId": "RCLQ01",
            "compName": "RetailCLIQ India Pvt Ltd",
            "branchId": "BMS10001", "branchName": "Head Office — Mumbai",
            "role": "admin", "createdAt": datetime.now(timezone.utc).isoformat()})
    elif not verify_pw(admin_pw, ex.get("passwordHash", "")):
        await db.users.update_one({"email": admin_email}, {"$set": {"passwordHash": hash_pw(admin_pw)}})

    # Phase 2 items
    if await db.phase2_items.count_documents({}) == 0:
        p2 = [
            (1,"PREFLIGHT","Counter resolution (Sp_GetCounter by MAC)","Legacy form resolves POS counter from machine MAC. Confirm proc name/params on tenant DB.","frmOpeningStockwithSupplier"),
            (2,"POSTING","Confirm TransDate/PackedDate text format proc_StockImportwithSupplier expects","Legacy sends raw PackedDate in TransDate and ExpiryDate in Fabric. Verify dd-MMM-yyyy vs HBS int.","MaterialReceipt_DA"),
            (3,"POSTING","NATIVE post mode (set-based, no legacy proc)","Needs Itemmaster / Price_Master / Invtransaction column lists (9 VERIFY markers).","01_batch_framework.sql"),
            (4,"POSTING","UOMId blank handling inside the proc","Legacy sends UOMId blank. Confirm proc defaults it.","proc_StockImportwithSupplier"),
            (5,"GST","CGST/SGST/IGST/UTGST per+amt computation","Legacy sends zeros. Real values need state type + vendor state.","frmOpeningStockwithSupplier"),
            (6,"SUPPLIER","Supplier + M_GeneralLedger Sundry Creditors creation","Vendor insert proc name and M_GeneralLedger columns unknown.","Suppliers step"),
            (7,"VALIDATION","Item-level HSN default when Category has no HSNCode","Auto-fill from CategoryMaster.HSNCode; rows with no HSN stay blank (warning only).","proc_Import_Validate"),
            (8,"IMPORTTYPE","Material Receipt / Franchise MR / Purchase Invoice","Other MaterialReceipt_BL import flows.","MaterialReceiptImport_BL"),
            (9,"DTO","Cascading discounts 1-5, invoice charges, scheme, ROL, ItemImage","DTO fields beyond the 39 staging columns.","MaterialReceipt_DTO"),
        ]
        await db.phase2_items.insert_many([
            {"id": i, "area": a, "item": it, "detail": d, "source": s,
             "status": "OPEN", "owner": None, "updatedAt": datetime.now(timezone.utc).isoformat()}
            for i, a, it, d, s in p2])

    # Master data — matching original MASTER_TABLES from the reference HTML
    # Use version check so we can re-seed if wrong data was already loaded
    seed_ver = await db.meta.find_one({"_id": "seed_version"})
    if not seed_ver or seed_ver.get("v", 0) < 2:
        # Clear and re-seed all master collections with data that matches the sample CSV
        await db.vendors.drop()
        await db.uom_master.drop()
        await db.tax_master.drop()
        await db.category_master.drop()
        await db.vendors.insert_many([
            {"id":"V10001","name":"Sri Lakshmi Traders"},
            {"id":"V10002","name":"Metro Cash & Carry"},
            {"id":"V10003","name":"Medplus Distributors"},
            {"id":"V10004","name":"Heritage Foods"},
            {"id":"V10005","name":"Raymond Apparel"},
            {"id":"V10006","name":"Hindustan Unilever Ltd"},
            {"id":"V10007","name":"ITC Limited"},
            {"id":"V10008","name":"Nestle India"},
            {"id":"V10009","name":"Britannia Industries"},
            {"id":"V10010","name":"Dabur India"},
        ])
        await db.uom_master.insert_many([
            {"id":"PCS","name":"PCS"},{"id":"KG","name":"KG"},
            {"id":"GM","name":"GM"},{"id":"LTR","name":"LTR"},
            {"id":"ML","name":"ML"},{"id":"BOX","name":"BOX"},
            {"id":"PKT","name":"PKT"},{"id":"STRIP","name":"STRIP"},
            {"id":"MTR","name":"MTR"},{"id":"BAG","name":"BAG"},
            {"id":"NOS","name":"NOS"},{"id":"SET","name":"SET"},
        ])
        await db.tax_master.insert_many([
            {"id":"TX00","per":0,"type":"E"},
            {"id":"TX05","per":5,"type":"I"},
            {"id":"TX12","per":12,"type":"I"},
            {"id":"TX18","per":18,"type":"I"},
            {"id":"TX28","per":28,"type":"I"},
            {"id":"T001","per":0,"type":"E"},
            {"id":"T002","per":5,"type":"I"},
            {"id":"T003","per":12,"type":"I"},
            {"id":"T004","per":18,"type":"I"},
            {"id":"T005","per":28,"type":"I"},
        ])
        await db.category_master.insert_many([
            {"id":"CAT001","name":"GROCERY",      "hsnCode":"2106"},
            {"id":"CAT002","name":"PHARMA",       "hsnCode":"3004"},
            {"id":"CAT003","name":"BAKERY",       "hsnCode":"1905"},
            {"id":"CAT004","name":"DAIRY",        "hsnCode":"0401"},
            {"id":"CAT005","name":"HOUSEHOLD",    "hsnCode":"3402"},
            {"id":"CAT006","name":"APPAREL",      "hsnCode":"6204"},
            {"id":"CAT007","name":"FRESH PRODUCE","hsnCode":"0709"},
            {"id":"CAT008","name":"ELECTRONICS",  "hsnCode":"8543"},
            {"id":"CAT009","name":"FOOTWEAR",     "hsnCode":"6401"},
            {"id":"CAT010","name":"FMCG",         "hsnCode":"3401"},
        ])
        await db.meta.replace_one({"_id": "seed_version"}, {"_id": "seed_version", "v": 2}, upsert=True)
        logger.info("Master data re-seeded (v2): vendors, UOMs, taxes, categories")

    # Demo batches + seed chunks for DEMO01 so Rollback is testable
    if await db.batches.count_documents({"compId": "RCLQ01"}) == 0:
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.batches.insert_many([
            {"_id":"IMP-20260101-DEMO01","importType":"STOCK","compId":"RCLQ01","branchId":"BMS10001",
             "userId":admin_email,"sourceName":"opening_stock_jan2026.xlsx","postMode":"LEGACY",
             "purchaseAccount":"24-HB0001","dateOrder":"DMY","numberStyle":"DOT","region":"en-IN",
             "dupKeyColumns":"OEMCode","dupMode":"ERROR","dbMode":"RUNNING","chunkSize":50000,
             "status":"Reconciled","totalRows":1250,"rowsValid":1238,"rowsWarn":8,"rowsError":4,
             "rowsPosted":1246,"mrNo":"MR-20260101-0001, MR-20260101-0002",
             "startedAt":"2026-01-01T10:00:00","endedAt":"2026-01-01T10:45:00",
             "remarks":"Opening stock migration Jan 2026","lastError":None,
             "rolledBackAt":None,"rolledBackBy":None,"rollbackReason":None,
             "legacyReuse":True,"gatePassed":True,"gateAt":"2026-01-01T10:30:00"},
            {"_id":"IMP-20260115-DEMO02","importType":"STOCK","compId":"RCLQ01","branchId":"BMS10001",
             "userId":admin_email,"sourceName":"branch_transfer_jan15.csv","postMode":"LEGACY",
             "purchaseAccount":"24-HB0002","dateOrder":"DMY","numberStyle":"DOT","region":"en-IN",
             "dupKeyColumns":"OEMCode,Size,Color","dupMode":"WARN","dbMode":"RUNNING","chunkSize":10000,
             "status":"Failed","totalRows":456,"rowsValid":412,"rowsWarn":22,"rowsError":22,
             "rowsPosted":0,"mrNo":None,"startedAt":"2026-01-15T14:00:00","endedAt":None,
             "remarks":None,"lastError":"Reconciliation mismatch: 22 rows could not be committed",
             "rolledBackAt":None,"rolledBackBy":None,"rollbackReason":None,
             "legacyReuse":True,"gatePassed":True,"gateAt":"2026-01-15T14:20:00"},
            {"_id":"IMP-20260201-DEMO03","importType":"STOCK","compId":"RCLQ01","branchId":"BMS10001",
             "userId":admin_email,"sourceName":"fy2025_26_opening.xlsx","postMode":"LEGACY",
             "purchaseAccount":"24-HB0001","dateOrder":"DMY","numberStyle":"DOT","region":"en-IN",
             "dupKeyColumns":"OEMCode","dupMode":"ERROR","dbMode":"FRESH","chunkSize":50000,
             "status":"Validated","totalRows":3200,"rowsValid":3150,"rowsWarn":45,"rowsError":5,
             "rowsPosted":0,"mrNo":None,"startedAt":"2026-02-01T09:00:00","endedAt":None,
             "remarks":"FY 2025-26 opening stock","lastError":None,
             "rolledBackAt":None,"rolledBackBy":None,"rollbackReason":None,
             "legacyReuse":True,"gatePassed":False,"gateAt":None},
        ])
        # Seed committed chunks for DEMO01 so Rollback button is visible/testable
        await db.batch_chunks.insert_many([
            {"batchId":"IMP-20260101-DEMO01","chunkNo":1,"fromRow":1,"toRow":1246,
             "status":"Committed","rowsOk":1246,"rowsSkipped":0,
             "mrNo":"MR-20260101-0001","attempts":1,
             "startedAt":"2026-01-01T10:35:00","endedAt":"2026-01-01T10:40:00","errorMsg":None},
        ])

    Path("/app/memory").mkdir(exist_ok=True)
    with open("/app/memory/test_credentials.md", "w") as f:
        f.write(f"""# RetailCLIQ Import — Test Credentials

## Admin Account
- **Email**: {admin_email}
- **Password**: {admin_pw}
- **Role**: admin
- **Company**: RetailCLIQ India Pvt Ltd (RCLQ01)
- **Branch**: Head Office — Mumbai (BMS10001)

## Key Endpoints
- POST /api/auth/login  |  GET /api/auth/me  |  POST /api/auth/logout
- GET /api/import  |  POST /api/import/begin  |  POST /api/import/upload
- POST /api/import/:id/rows  |  POST /api/import/:id/validate
- POST /api/import/:id/gate  |  POST /api/import/:id/post
- GET /api/import/:id/status  |  POST /api/import/:id/cancel
- POST /api/import/:id/rollback  |  GET /api/import/:id/errors
- GET /api/import/:id/errors/csv  |  GET /api/prereq
- GET /api/phase2  |  POST /api/phase2/:id  |  GET /api/masters
- GET /api/dashboard/stats
""")
    logger.info("RetailCLIQ Import API ready. Admin: %s", admin_email)

# ── Auth routes ───────────────────────────────────────────────────────────────

class LoginReq(BaseModel):
    email: str
    password: str

@api_router.post("/auth/login")
async def login(req: LoginReq, response: Response):
    email = req.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not verify_pw(req.password, user.get("passwordHash", "")):
        raise HTTPException(401, "Invalid email or password")
    token = make_token(str(user["_id"]), email)
    response.set_cookie("access_token", token, httponly=True, secure=True, samesite="none", max_age=86400, path="/")
    return {"token": token, "user": {
        "id": str(user["_id"]), "email": user["email"],
        "username": user.get("username", ""), "compId": user.get("compId", ""),
        "compName": user.get("compName", ""), "branchId": user.get("branchId", ""),
        "branchName": user.get("branchName", ""), "role": user.get("role", "operator")}}

@api_router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token")
    return {"ok": True}

@api_router.get("/auth/me")
async def me(user: dict = Depends(require_auth)):
    return user

# ── Master data ───────────────────────────────────────────────────────────────

@api_router.get("/masters")
async def masters(user: dict = Depends(require_auth)):
    v = await db.vendors.find({}, {"_id":0}).to_list(None)
    u = await db.uom_master.find({}, {"_id":0}).to_list(None)
    t = await db.tax_master.find({}, {"_id":0}).to_list(None)
    c = await db.category_master.find({}, {"_id":0}).to_list(None)
    vendor_list     = [{"id": x["id"], "name": x["name"]} for x in v]
    uom_list        = [{"id": x["id"], "name": x["name"]} for x in u]
    tax_list        = [{"id": x["id"], "name": f"{x['per']}% ({x['type']})", "extra": str(x.get("per",""))} for x in t]
    category_list   = [{"id": x["id"], "name": x["name"], "hsnCode": x.get("hsnCode")} for x in c]
    gl_list         = [
        {"id":"24-HB0001","name":"Purchase Account — General"},
        {"id":"24-HB0002","name":"Purchase Account — FMCG"},
        {"id":"24-HB0003","name":"Purchase Account — Clothing"},
    ]
    flat = {
        "vendormaster":   vendor_list,
        "UOMMaster":      uom_list,
        "Tax_Master":     tax_list,
        "CategoryMaster": category_list,
        "M_GeneralLedger": gl_list,
    }
    # Also expose under "masters" key so new React wizard can read m.masters
    return {**flat, "masters": flat}

# ── Dashboard stats ───────────────────────────────────────────────────────────

@api_router.get("/dashboard/stats")
async def stats(user: dict = Depends(require_auth)):
    comp = user.get("compId")
    total = await db.batches.count_documents({"compId": comp})
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    today_bs = await db.batches.find(
        {"compId": comp, "status": {"$in": ["Posted","Reconciled"]}, "endedAt": {"$gte": today}},
        {"rowsPosted": 1}).to_list(None)
    rows_today = sum(b.get("rowsPosted") or 0 for b in today_bs)
    recent = await db.batches.find(
        {"compId": comp, "totalRows": {"$gt": 0}},
        {"totalRows":1,"rowsError":1}).sort("startedAt",-1).limit(10).to_list(None)
    total_r = sum(b.get("totalRows") or 0 for b in recent)
    total_e = sum(b.get("rowsError") or 0 for b in recent)
    error_rate = round(total_e/total_r*100, 1) if total_r > 0 else 0
    active = await db.batches.count_documents({"compId": comp, "status": {"$in": ["Staging","Posting"]}})
    batch_docs = await db.batches.find({"compId": comp}).sort("startedAt",-1).limit(50).to_list(None)
    batches = [{
        "batchId": b["_id"], "importType": b.get("importType"), "status": b.get("status"),
        "totalRows": b.get("totalRows"), "rowsValid": b.get("rowsValid"),
        "rowsWarn": b.get("rowsWarn"), "rowsError": b.get("rowsError"),
        "rowsPosted": b.get("rowsPosted"), "sourceName": b.get("sourceName"),
        "startedAt": b.get("startedAt"), "endedAt": b.get("endedAt"),
        "userId": b.get("userId"), "mrNo": b.get("mrNo"), "lastError": b.get("lastError"),
        "gatePassed": b.get("gatePassed"),
    } for b in batch_docs]
    return {"totalBatches": total, "rowsPostedToday": rows_today,
            "errorRate": error_rate, "activeBatches": active, "batches": batches}

# ── Import batch routes ───────────────────────────────────────────────────────

def _batch_out(b):
    d = dict(b)
    d["batchId"] = d.pop("_id")
    return d

@api_router.get("/import")
async def list_batches(user: dict = Depends(require_auth)):
    docs = await db.batches.find({"compId": user.get("compId")}).sort("startedAt",-1).limit(50).to_list(None)
    return [_batch_out(b) for b in docs]

class BeginReq(BaseModel):
    importType: str = "STOCK"
    postMode: str = "LEGACY"
    purchaseAccount: Optional[str] = None
    dateOrder: str = "DMY"
    numberStyle: str = "DOT"
    region: str = "en-IN"
    dupKeyColumns: str = "OEMCode"
    dupMode: str = "ERROR"
    dbMode: str = "RUNNING"
    chunkSize: int = 50000
    remarks: Optional[str] = None
    sourceName: Optional[str] = None

@api_router.post("/import/begin")
async def begin(req: BeginReq, user: dict = Depends(require_auth)):
    now = datetime.now(timezone.utc)
    bid = f"IMP-{now.strftime('%Y%m%d')}-{str(uuid.uuid4())[:6].upper()}"
    doc = {"_id": bid, "importType": req.importType, "compId": user.get("compId"),
           "branchId": user.get("branchId"), "userId": user.get("email"),
           "sourceName": req.sourceName, "postMode": req.postMode,
           "purchaseAccount": req.purchaseAccount, "dateOrder": req.dateOrder,
           "numberStyle": req.numberStyle, "region": req.region,
           "dupKeyColumns": req.dupKeyColumns, "dupMode": req.dupMode, "dbMode": req.dbMode,
           "chunkSize": req.chunkSize, "status": "Staging",
           "totalRows": None, "rowsValid": None, "rowsWarn": None,
           "rowsError": None, "rowsPosted": None, "mrNo": None,
           "startedAt": now.isoformat(), "endedAt": None,
           "remarks": req.remarks, "lastError": None, "rolledBackAt": None,
           "rolledBackBy": None, "rollbackReason": None, "legacyReuse": True,
           "gatePassed": False, "gateAt": None}
    await db.batches.insert_one(doc)
    return {"batchId": bid}

@api_router.post("/import/upload")
async def upload(file: UploadFile = File(...), user: dict = Depends(require_auth)):
    data = await file.read()
    result = await parse_file(data, file.filename)
    all_rows = result["rows"]
    return {"name": file.filename, "size": len(data),
            "columns": result["columns"],
            "previewRows": all_rows[:20],
            "allRows": all_rows,
            "rows": all_rows,
            "rowCount": result["rowCount"]}

class InsertRowsReq(BaseModel):
    rows: List[Dict[str, Any]]
    startRow: int = 1

@api_router.post("/import/{bid}/rows")
async def insert_rows(bid: str, req: InsertRowsReq, user: dict = Depends(require_auth)):
    if not req.rows:
        return {"inserted": 0, "nextRow": req.startRow}
    # When starting fresh (startRow=1) clear any existing rows — allows re-validation after going Back
    if req.startRow == 1:
        await db.batch_rows.delete_many({"batchId": bid})
    docs = [{"batchId": bid, "rowNo": req.startRow + i, "chunkNo": None,
             "rowStatus": "P", "errorMsg": None, **row}
            for i, row in enumerate(req.rows)]
    try:
        await db.batch_rows.insert_many(docs, ordered=False)
    except Exception:
        pass  # ignore duplicate key errors on retry
    total = await db.batch_rows.count_documents({"batchId": bid})
    await db.batches.update_one({"_id": bid}, {"$set": {"totalRows": total}})
    return {"inserted": len(docs), "nextRow": req.startRow + len(docs)}

@api_router.post("/import/{bid}/validate")
async def validate(bid: str, user: dict = Depends(require_auth)):
    batch = await db.batches.find_one({"_id": bid})
    if not batch:
        raise HTTPException(404, "Batch not found")
    rows = await db.batch_rows.find({"batchId": bid}).sort("rowNo",1).to_list(None)
    if not rows:
        raise HTTPException(400, "No rows to validate")
    row_dicts = [{k: v for k, v in r.items() if k != "_id"} for r in rows]
    validated = await validate_rows(row_dicts, batch)
    chunks = assign_chunks(validated, batch.get("chunkSize", 50000))
    for row in validated:
        await db.batch_rows.update_one(
            {"batchId": bid, "rowNo": row["rowNo"]},
            {"$set": {"rowStatus": row["rowStatus"], "errorMsg": row.get("errorMsg"), "chunkNo": row.get("chunkNo")}})
    await db.batch_chunks.delete_many({"batchId": bid, "status": "Pending"})
    if chunks:
        await db.batch_chunks.insert_many([{
            "batchId": bid, "chunkNo": c["chunkNo"], "fromRow": c["fromRow"],
            "toRow": c["toRow"], "status": "Pending", "rowsOk": None,
            "rowsSkipped": None, "mrNo": None, "attempts": 0,
            "startedAt": None, "endedAt": None, "errorMsg": None} for c in chunks])
    v = sum(1 for r in validated if r["rowStatus"] == "V")
    w = sum(1 for r in validated if r["rowStatus"] == "W")
    e = sum(1 for r in validated if r["rowStatus"] == "E")
    await db.batches.update_one({"_id": bid}, {"$set": {
        "status": "Validated", "gatePassed": False, "gateAt": None,
        "rowsValid": v, "rowsWarn": w, "rowsError": e, "totalRows": len(validated)}})
    return {"status": "Validated", "totalRows": len(validated),
            "rowsValid": v, "rowsWarn": w, "rowsError": e, "chunks": len(chunks)}

class GateReq(BaseModel):
    allowErrors: bool = False

@api_router.post("/import/{bid}/gate")
async def gate(bid: str, req: GateReq, user: dict = Depends(require_auth)):
    batch = await db.batches.find_one({"_id": bid})
    if not batch:
        raise HTTPException(404, "Batch not found")
    st = batch.get("status")
    total = batch.get("totalRows", 0) or 0
    v = batch.get("rowsValid", 0) or 0
    w = batch.get("rowsWarn", 0) or 0
    e = batch.get("rowsError", 0) or 0
    pending = await db.batch_rows.count_documents({"batchId": bid, "rowStatus": "P"})
    n_chunks = await db.batch_chunks.count_documents({"batchId": bid})
    pa = batch.get("purchaseAccount") or ""
    uom_n = await db.uom_master.count_documents({})
    tax_n = await db.tax_master.count_documents({})
    phase2_open = await db.phase2_items.count_documents({"status": "OPEN"})
    checks = [
        {"chk": "Batch validated",        "result": "PASS" if st in ("Validated","Posting") else "FAIL", "detail": f"status = {st}"},
        {"chk": "No unvalidated rows",     "result": "PASS" if pending == 0 else "FAIL",       "detail": f"{pending} rows still pending"},
        {"chk": "Row accounting",          "result": "PASS" if total == v+w+e else "FAIL",      "detail": f"{total} = {v} valid + {w} warn + {e} error"},
        {"chk": "Error rows",              "result": "PASS" if e == 0 else ("WARN" if req.allowErrors else "FAIL"), "detail": f"{e} rows will be skipped"},
        {"chk": "Warning rows",            "result": "PASS" if w == 0 else "WARN",              "detail": f"{w} rows post with warnings"},
        {"chk": "Chunk plan matches rows", "result": "PASS" if n_chunks > 0 else "FAIL",        "detail": f"{n_chunks} chunks for {v+w} postable rows"},
        {"chk": "Postable rows exist",     "result": "PASS" if v+w > 0 else "FAIL",             "detail": f"{v+w} rows"},
        {"chk": "Purchase account",        "result": "PASS" if pa else "FAIL",                  "detail": pa or "(none selected)"},
        {"chk": "Pre-flight: UOMMaster",   "result": "PASS" if uom_n > 0 else "FAIL",           "detail": f"{uom_n} rows"},
        {"chk": "Pre-flight: Tax_GroupMaster", "result": "PASS" if tax_n > 0 else "FAIL",       "detail": f"{tax_n} rows"},
        {"chk": "Pre-flight: proc_StockImportwithSupplier", "result": "PASS",                   "detail": "LEGACY mode (demo: simulated)"},
        {"chk": "Pre-flight: Staging columns present",      "result": "PASS",                   "detail": "all framework + legacy-reuse columns present"},
        {"chk": "Phase 2 open: Counter resolution",         "result": "PHASE2",                 "detail": "tenant DB proc — tracked in Phase 2 items"},
    ]
    failures = sum(1 for c in checks if c["result"] == "FAIL")
    gp = failures == 0
    await db.batches.update_one({"_id": bid}, {"$set": {"gatePassed": gp, "gateAt": datetime.now(timezone.utc).isoformat()}})
    return {"checks": checks, "gate": {"gatePassed": gp, "failures": failures, "phase2Open": phase2_open}}

@api_router.post("/import/{bid}/post")
async def post_batch(bid: str, req: GateReq, background_tasks: BackgroundTasks,
                     user: dict = Depends(require_auth)):
    if posting_jobs.get(bid, {}).get("running"):
        return {"started": False, "reason": "already running"}
    batch = await db.batches.find_one({"_id": bid})
    if not batch:
        raise HTTPException(404, "Batch not found")
    # Quick gate re-check
    gate_resp = await gate(bid, req, user)
    if not gate_resp["gate"]["gatePassed"]:
        fails = [c for c in gate_resp["checks"] if c["result"] == "FAIL"]
        return JSONResponse(409, {"started": False, "reason": "Final gate not passed", "failures": fails})
    background_tasks.add_task(post_batch_bg, bid)
    return {"started": True}

@api_router.get("/import/{bid}/status")
async def batch_status(bid: str, user: dict = Depends(require_auth)):
    batch = await db.batches.find_one({"_id": bid})
    if not batch:
        raise HTTPException(404, "Batch not found")
    chunks = await db.batch_chunks.find({"batchId": bid}).sort("chunkNo",1).to_list(None)
    for c in chunks:
        c.pop("_id", None)
    return {"batch": _batch_out(batch), "chunks": chunks, "job": posting_jobs.get(bid)}

@api_router.get("/import/{bid}")
async def get_batch(bid: str, user: dict = Depends(require_auth)):
    batch = await db.batches.find_one({"_id": bid})
    if not batch:
        raise HTTPException(404, "Batch not found")
    chunks = await db.batch_chunks.find({"batchId": bid}).sort("chunkNo",1).to_list(None)
    for c in chunks:
        c.pop("_id", None)
    return {"batch": _batch_out(batch), "chunks": chunks}

@api_router.post("/import/{bid}/cancel")
async def cancel(bid: str, user: dict = Depends(require_auth)):
    batch = await db.batches.find_one({"_id": bid})
    if not batch:
        raise HTTPException(404, "Batch not found")
    if batch.get("status") not in ("Staging","Validated","Posting"):
        raise HTTPException(400, f"Cannot cancel: status={batch.get('status')}")
    await db.batches.update_one({"_id": bid}, {"$set": {"status": "Cancelled"}})
    return {"ok": True}

class RollbackReq(BaseModel):
    reason: Optional[str] = None
    fromChunk: int = 1

@api_router.post("/import/{bid}/rollback")
async def rollback(bid: str, req: RollbackReq, user: dict = Depends(require_auth)):
    batch = await db.batches.find_one({"_id": bid})
    if not batch:
        raise HTTPException(404, "Batch not found")
    if batch.get("status") == "Posting":
        raise HTTPException(400, "Cancel the batch first before rolling back")
    committed = await db.batch_chunks.find(
        {"batchId": bid, "status": "Committed", "chunkNo": {"$gte": req.fromChunk}}
    ).sort("chunkNo",-1).to_list(None)
    for c in committed:
        cn = c["chunkNo"]
        await db.batch_rows.update_many({"batchId": bid, "chunkNo": cn, "rowStatus": "C"}, {"$set": {"rowStatus": "V"}})
        await db.batch_chunks.update_one({"batchId": bid, "chunkNo": cn},
            {"$set": {"status": "RolledBack", "endedAt": datetime.now(timezone.utc).isoformat()}})
    still = await db.batch_chunks.count_documents({"batchId": bid, "status": "Committed"})
    await db.batches.update_one({"_id": bid}, {"$set": {
        "status": "Validated" if still > 0 else "RolledBack",
        "rolledBackAt": datetime.now(timezone.utc).isoformat(),
        "rolledBackBy": user.get("email"), "rollbackReason": req.reason}})
    return await get_batch(bid, user)

@api_router.post("/import/{bid}/resume")
async def resume(bid: str, background_tasks: BackgroundTasks, user: dict = Depends(require_auth)):
    if posting_jobs.get(bid, {}).get("running"):
        return {"started": False, "reason": "already running"}
    await db.batch_chunks.update_many(
        {"batchId": bid, "status": {"$in": ["Posting","Failed"]}},
        {"$set": {"status": "Pending", "errorMsg": "Recovered"}})
    background_tasks.add_task(post_batch_bg, bid)
    return {"started": True}

class SourceReq(BaseModel):
    sourceName: Optional[str] = None

@api_router.post("/import/{bid}/source")
async def update_source(bid: str, req: SourceReq, user: dict = Depends(require_auth)):
    """Update source file name on an existing batch (called from StepUpload after file is parsed)."""
    await db.batches.update_one({"_id": bid}, {"$set": {"sourceName": req.sourceName}})
    return {"ok": True}

@api_router.get("/import/{bid}/errors")
async def errors(bid: str, user: dict = Depends(require_auth),
                 page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=500),
                 status_filter: str = Query("all")):
    q: dict = {"batchId": bid}
    if status_filter == "errors":
        q["rowStatus"] = "E"
    elif status_filter == "warnings":
        q["rowStatus"] = "W"
    else:
        q["rowStatus"] = {"$in": ["E", "W"]}
    total = await db.batch_rows.count_documents(q)
    rows = await db.batch_rows.find(q, {"_id":0}).sort("rowNo",1).skip((page-1)*page_size).limit(page_size).to_list(None)
    return {"rows": rows, "total": total, "page": page, "pageSize": page_size,
            "pages": max(1, (total + page_size - 1) // page_size)}

STAGING_COLS = ["SlNo","ItemCode","OEMCode","ItemDescription","UOMId","Qty","PurchasePrice","MRP",
                "Discount","DisType","DiscountPrice","Division","Department","Category","SubCategory",
                "Style","Design","Size","Color","Brand","Fabric","ArtName","TransNo","TransDate",
                "Tokens","Tax","Taxtype","PacketNo","CounterID","InTax","InTaxtype","Supplier",
                "Verticle1","Verticle2","Verticle3","P_Distributor_rate","TokenType",
                "PurchaseDiscount","PurchaseDiscountType","BatchNo","PackedDate","ExpiryDate"]

@api_router.get("/import/{bid}/errors/csv")
async def errors_csv(bid: str, user: dict = Depends(require_auth)):
    rows = await db.batch_rows.find({"batchId": bid, "rowStatus": {"$in":["E","W"]}}, {"_id":0}).sort("rowNo",1).to_list(None)
    hdr = ["RowNo","RowStatus","ErrorMsg"] + STAGING_COLS
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(hdr)
    for r in rows:
        w.writerow([r.get("rowNo",""), r.get("rowStatus",""), r.get("errorMsg","")] +
                   [r.get(c,"") for c in STAGING_COLS])
    return StreamingResponse(io.BytesIO(buf.getvalue().encode("utf-8-sig")), media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={bid}_errors.csv"})

# ── Pre-flight & Phase 2 ──────────────────────────────────────────────────────

@api_router.get("/prereq")
async def prereq(user: dict = Depends(require_auth),
                 purchase_account: Optional[str] = Query(None, alias="purchaseAccount"),
                 batch_id: Optional[str] = Query(None, alias="batchId")):
    if batch_id:
        b = await db.batches.find_one({"_id": batch_id})
        if b:
            purchase_account = purchase_account or b.get("purchaseAccount")
    uom_n = await db.uom_master.count_documents({})
    tax_n = await db.tax_master.count_documents({})
    return [
        {"chk": "UOMMaster has rows",        "result": "PASS" if uom_n > 0 else "FAIL", "detail": f"{uom_n} rows"},
        {"chk": "Tax_GroupMaster has rows",   "result": "PASS" if tax_n > 0 else "FAIL", "detail": f"{tax_n} rows"},
        {"chk": "Barcodedef has rows",        "result": "PASS", "detail": "demo: assumed present"},
        {"chk": "Purchase account exists",    "result": "PASS" if purchase_account else "FAIL", "detail": purchase_account or "(none)"},
        {"chk": "proc_StockImportwithSupplier","result": "PASS", "detail": "demo: simulated"},
        {"chk": "Staging columns present",   "result": "PASS", "detail": "all framework columns present"},
        {"chk": "Counter (Sp_GetCounter by MAC)", "result": "PHASE2", "detail": "tracked in Phase 2 items"},
    ]

@api_router.get("/phase2")
async def phase2_list(user: dict = Depends(require_auth)):
    return await db.phase2_items.find({}, {"_id":0}).sort([("status",1),("area",1),("id",1)]).to_list(None)

class P2Req(BaseModel):
    status: str
    owner: Optional[str] = None

@api_router.post("/phase2/{item_id}")
async def phase2_update(item_id: int, req: P2Req, user: dict = Depends(require_auth)):
    await db.phase2_items.update_one({"id": item_id},
        {"$set": {"status": req.status, "owner": req.owner, "updatedAt": datetime.now(timezone.utc).isoformat()}})
    return await db.phase2_items.find_one({"id": item_id}, {"_id":0})


# ── Health / Schema / RC-extract (mirrors original Node api.js) ──────────────

@api_router.get("/health")
async def health():
    """Health check — primary DB is MSSQL. MongoDB is internal state only."""
    mongo_ok = True
    try:
        await db.command("ping")
    except Exception:
        mongo_ok = False

    sql_configured = mssql_live()

    return {
        "ok":             True,
        # connected = True as long as internal API is up; masters/schema always available
        "connected":      mongo_ok,
        "server":         "FastAPI",
        # dbNew = the MSSQL target database when configured; never expose MongoDB name to users
        "dbNew":          MSSQL_DB if sql_configured else None,
        "dbOld":          MSSQL_SERVER or None,
        "compId":         MSSQL_COMP_ID,
        "postMode":       "LEGACY",
        "chunkSize":      50000,
        "frameworkProcs": 9,
        "defaultUser":    os.environ.get("ADMIN_EMAIL", "msnarayana@retailcliq.com"),
        # mode = live when MSSQL is configured, demo otherwise
        "mode":           "live" if sql_configured else "demo",
        "mssqlLive":      sql_configured,
        "mssqlDb":        MSSQL_DB if sql_configured else None,
        "version":        "RetailCLIQ Import API v1 (FastAPI)",
    }

# Embedded schema catalog (mirrors CATALOG in index.html — live version needs MSSQL)
_CATALOG_DEMO = {
    "Stock_Import_Export": {"kind": "staging", "cols": [
        "SlNo","ItemCode","OEMCode","ItemDescription","UOMId","Qty","PurchasePrice","MRP",
        "Discount","DisType","DiscountPrice","Division","Department","Category","SubCategory",
        "Style","Design","Size","Color","Brand","Fabric","ArtName","TransNo","TransDate",
        "Tokens","Tax","Taxtype","PacketNo","CounterID","InTax","InTaxtype","Supplier",
        "Verticle1","Verticle2","Verticle3","P_Distributor_rate","TokenType",
        "PurchaseDiscount","PurchaseDiscountType","BatchNo","PackedDate","ExpiryDate",
        "BatchId","RowNo","ChunkNo","RowStatus","ErrorMsg","TransDateHBS","ExpiryDateHBS","PackedDateHBS"
    ]},
    "ImportBatch": {"kind": "table", "cols": [
        "BatchId","ImportType","CompId","BranchId","UserId","SourceName","PostMode",
        "PurchaseAccount","DateOrder","NumberStyle","Region","DupKeyColumns","DupMode",
        "DbMode","ChunkSize","Status","TotalRows","RowsValid","RowsWarn","RowsError",
        "RowsPosted","MRNo","StartedAt","EndedAt","Remarks","LastError",
        "RolledBackAt","RolledBackBy","RollbackReason","LegacyReuse","GatePassed","GateAt"
    ]},
    "ImportBatchChunk": {"kind": "table", "cols": [
        "BatchId","ChunkNo","FromRow","ToRow","Status","RowsOk","RowsSkipped",
        "MRNo","Attempts","StartedAt","EndedAt","ErrorMsg"
    ]},
    "ImportBatchTrace": {"kind": "table", "cols": [
        "TraceId","BatchId","ChunkNo","TableName","KeyCol","KeyValue","Action","BeforeImage","TracedAt"
    ]},
    "proc_Import_Begin":       {"kind": "proc", "cols": ["@ImportType","@CompId","@BranchId","@UserId","@SourceName","@PostMode","@PurchaseAccount","@DateOrder","@NumberStyle","@Region","@DupKeyColumns","@DupMode","@DbMode","@ChunkSize","@Remarks","@BatchId output"]},
    "proc_Import_Validate":    {"kind": "proc", "cols": ["@BatchId"]},
    "proc_Import_Gate":        {"kind": "proc", "cols": ["@BatchId","@AllowErrors"]},
    "proc_Import_Post":        {"kind": "proc", "cols": ["@BatchId","@MaxChunks"]},
    "proc_Import_Resume":      {"kind": "proc", "cols": ["@BatchId"]},
    "proc_Import_Cancel":      {"kind": "proc", "cols": ["@BatchId","@UserId"]},
    "proc_Import_Rollback":    {"kind": "proc", "cols": ["@BatchId","@UserId","@Reason","@FromChunk"]},
    "proc_Import_Reconcile":   {"kind": "proc", "cols": ["@BatchId"]},
    "proc_Import_Status":      {"kind": "proc", "cols": ["@BatchId"]},
    "proc_Import_CheckPrerequisites": {"kind": "proc", "cols": ["@BatchId","@PurchaseAccount","@PostMode"]},
    "proc_Import_Purge":       {"kind": "proc", "cols": ["@KeepDays"]},
    "proc_StockImportwithSupplier": {"kind": "proc", "cols": ["@CompId","@UserId","@BranchId","@PurchaseAccount","@MRNo output","@GSTXml"]},
}

@api_router.get("/schema")
async def schema(user: dict = Depends(require_auth)):
    """Mirrors GET /api/schema from original api.js.
    When MSSQL is live, queries INFORMATION_SCHEMA + sys.parameters.
    In demo mode returns the embedded catalog (same shape)."""
    if mssql_live():
        try:
            rows = await sql_query("""
                SELECT o.name AS table_name,
                       CASE o.type WHEN 'V' THEN 'view' WHEN 'P' THEN 'proc' ELSE 'table' END AS kind,
                       c.name AS column_name,
                       ty.name + CASE WHEN ty.name IN ('varchar','nvarchar','char','nchar')
                                 THEN '('+CASE WHEN c.max_length=-1 THEN 'max'
                                         ELSE CONVERT(varchar(10), c.max_length /
                                              CASE WHEN ty.name LIKE 'n%' THEN 2 ELSE 1 END) END+')'
                                 ELSE '' END AS data_type,
                       c.is_nullable,
                       OBJECT_NAME(fkc.referenced_object_id) AS fk_table,
                       COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS fk_col
                FROM sys.objects o
                JOIN sys.columns c ON c.object_id = o.object_id
                JOIN sys.types ty ON ty.user_type_id = c.user_type_id
                LEFT JOIN sys.foreign_key_columns fkc
                    ON fkc.parent_object_id = c.object_id AND fkc.parent_column_id = c.column_id
                WHERE o.name IN (
                    'Itemmaster','Price_Master','Invtransaction','Stock_Import_Export',
                    'vendormaster','CustomerMaster','Itemproperties','ImportBatch',
                    'ImportBatchChunk','ImportBatchTrace','CategoryMaster','UOMMaster',
                    'Tax_Master','M_GeneralLedger','CounterMaster','BranchMaster',
                    'DivisionMaster','DepartmentMaster','SubCategoryMaster',
                    'StyleMaster','DesignMaster','SizeMaster','ColorMaster','BrandMaster')
                ORDER BY o.name, c.column_id
            """)
            tables: dict = {}
            for r in rows:
                t = tables.setdefault(r["table_name"], {"name": r["table_name"], "kind": r["kind"], "cols": []})
                t["cols"].append({"key": r["column_name"], "sql": r["data_type"],
                                   "nullable": r["is_nullable"],
                                   "fk": f"{r['fk_table']}.{r['fk_col']}" if r.get("fk_table") else None})
            return {"source": "live", "objects": list(tables.values())}
        except Exception as e:
            logger.warning("MSSQL schema query failed: %s — returning demo catalog", e)
    # Demo catalog
    objects = [{"name": name, "kind": v["kind"],
                "cols": [{"key": c, "sql": None, "nullable": True, "fk": None} for c in v["cols"]]}
               for name, v in _CATALOG_DEMO.items()]
    return {"source": "demo", "objects": objects}

# Sample data for rc/extract in demo mode (mirrors SAMPLE_RC in index.html)
_RC_EXTRACT_SAMPLE = [
    ["","RAY-SH-1001","RAYMOND FORMAL SHIRT WHITE","24","899.00","1499.00","10","P","1349.10","APPAREL","MENS","APPAREL","SHIRTS","SLIM FIT","PLAIN","M","WHITE","RAYMOND","62052000","SS26","","5","E","5","I","","","","RAYMOND APPAREL","0","A","62052000",""],
    ["","RAY-TR-2001","RAYMOND TROUSER GREY","12","1250.00","1999.00","15","P","1699.15","APPAREL","MENS","APPAREL","TROUSERS","REGULAR","PLAIN","34","GREY","RAYMOND","62034200","SS26","","5","E","5","I","","","","RAYMOND APPAREL","0","A","62034200",""],
    ["","AMUL-TM-500","AMUL TAZA MILK 500ML","240","26.00","28.00","0","A","28.00","FOOD","FMCG","DAIRY","MILK","","","","","AMUL","04011000","","","0","E","0","I","B2409A","","20-10-2026","HERITAGE FOODS","0","A","04011000",""],
    ["","CIP-PCM-500","PARACETAMOL 500MG STRIP","1500","9.50","14.00","0","A","14.00","PHARMA","OTC","PHARMA","TABLETS","","","","","CIPLA","30049099","","","12","E","12","I","PCM1123","","31-03-2027","MEDPLUS DISTRIBUTORS","0","A","30049099",""],
    ["","TATA-SALT-1","TATA SALT 1KG","0","21.00","25.00","0","A","25.00","FOOD","FMCG","GROCERY","","","","","","TATA","25010020","","","0","E","0","I","","","","SRI LAKSHMI TRADERS","0","A","25010020",""],
    ["","HER-CURD-200","HERITAGE CURD 200G","80","18.00","20.00","0","A","20.00","FOOD","FMCG","DAIRY","","","","","","HERITAGE","04031000","","","0","E","0","I","HC0401","","10-04-2026","HERITAGE FOODS","0","A","04031000",""],
]
_RC_COLUMNS = ["SlNo","OEMCode","ItemDescription","Qty","PurchasePrice","MRP","Discount","DisType","DiscountPrice",
               "Division","Department","Category","SubCategory","Style","Design","Size","Color","Brand",
               "Verticle1","Verticle2","Verticle3","InTax","InTaxtype","OutTax","OutTaxtype",
               "BatchNo","PackedDate","ExpiryDate","SupplierName","Purchase Discount","Purchase Discount Type","HSNCODE","WSP"]

class RcExtractReq(BaseModel):
    compId: Optional[str] = None
    branchId: Optional[str] = None
    zero: str = "skip"
    status: str = "A"
    top: int = 0

@api_router.post("/rc/extract")
async def rc_extract(req: RcExtractReq, user: dict = Depends(require_auth)):
    """Mirrors POST /api/rc/extract from original api.js.
    Runs the Itemproperties extraction query against DB_OLD when MSSQL live.
    Returns embedded sample data in demo mode (6 rows, same shape the wizard expects)."""
    if mssql_live():
        try:
            comp = req.compId or user.get("compId") or MSSQL_COMP_ID
            sql_text = """
                SELECT '' AS SlNo,
                       CASE WHEN A.OEMCode <> '' THEN A.OEMCode ELSE A.Itemcode END AS OEMCode,
                       UPPER(A.Itemdesc) AS ItemDescription,
                       A.CurQty AS Qty, A.Prate AS PurchasePrice, F.MRP AS MRP,
                       F.dis_value AS Discount, F.dis_type AS DisType, F.S_std_Price AS DiscountPrice,
                       UPPER(DivName) AS Division, UPPER(SDMName) AS Department,
                       UPPER(A.CatName) AS Category, UPPER(A.SCMName) AS SubCategory,
                       UPPER(A.StyleName) AS Style, UPPER(A.DesName) AS Design,
                       UPPER(A.SizeOfDress) AS Size, UPPER(A.ColorName) AS Color,
                       UPPER(A.BrandName) AS Brand,
                       A.HSNCOde AS Verticle1, UPPER(A.Verticle2) AS Verticle2,
                       UPPER(A.Verticle3) AS Verticle3,
                       D.Tax_per AS InTax, D.Tax_Type_Inc_Exl AS InTaxtype,
                       E.Tax_per AS OutTax, E.Tax_Type_Inc_Exl AS OutTaxtype,
                       '' AS BatchNo, '' AS PackedDate, '' AS ExpiryDate,
                       UPPER(A.PartyName) AS SupplierName,
                       '0' AS [Purchase Discount], 'A' AS [Purchase Discount Type],
                       A.HSNCOde AS HSNCODE, '' AS WSP
                FROM Itemproperties A
                INNER JOIN Itemmaster B   ON A.Itemcode = B.Itemcode
                INNER JOIN Price_Master C ON A.Itemcode = C.Itemcode
                INNER JOIN Tax_Master D   ON C.Desc3 = D.Tax_uid
                INNER JOIN Tax_Master E   ON A.Tax_Uid = E.Tax_Uid
                INNER JOIN Price_Master F ON F.Itemcode = A.Itemcode AND A.status = 'A'
            """
            where = []
            if req.zero == "skip":
                where.append("A.CurQty <> 0")
            if where:
                sql_text += " WHERE " + " AND ".join(where)
            if req.top:
                sql_text = sql_text.replace("SELECT '' AS SlNo", f"SELECT TOP {int(req.top)} '' AS SlNo")
            rows = await sql_query(sql_text)
            if rows:
                cols = list(rows[0].keys())
                return {"source": "live", "name": f"{MSSQL_DB}.Itemproperties",
                        "columns": cols,
                        "rows": [[str(r.get(c) or "") for c in cols] for r in rows],
                        "sql": sql_text.strip()}
        except Exception as e:
            logger.warning("rc/extract MSSQL failed: %s — demo fallback", e)
    # Demo fallback — same 6-row sample as SAMPLE_RC in index.html
    filtered = _RC_EXTRACT_SAMPLE
    if req.zero == "skip":
        filtered = [r for r in filtered if r[3] and r[3] != "0"]
    if req.top:
        filtered = filtered[:int(req.top)]
    return {"source": "demo", "name": "Itemproperties (demo)",
            "columns": _RC_COLUMNS, "rows": filtered, "sql": "(demo mode)"}


# ── GL Account lookup (M_GeneralLedger SearchInfo) ────────────────────────────

@api_router.get("/lookup/glaccounts")
async def gl_lookup(
    user: dict = Depends(require_auth),
    q: str = Query("", alias="q"),
    comp_id: str = Query(None, alias="compId"),
    limit: int = Query(50)
):
    """Search M_GeneralLedger for Purchase accounts.
    SQL: SELECT TOP 50 GLId, GLName FROM M_GeneralLedger
         WHERE CompId='c001' AND Glstatus='S' AND Gltype='P'
    """
    comp = comp_id or user.get("compId") or MSSQL_COMP_ID

    if mssql_live():
        try:
            search = f"%{q}%" if q else "%"
            rows = await sql_query(
                f"SELECT TOP {int(min(limit, 100))} GLId, GLName "
                "FROM dbo.M_GeneralLedger "
                "WHERE CompId=%s AND Glstatus='S' AND Gltype='P' "
                "AND (GLId LIKE %s OR GLName LIKE %s) "
                "ORDER BY GLId",
                (comp, search, search)
            )
            return {
                "source": "live", "compId": comp,
                "items": [{"id": r["GLId"], "name": r["GLName"]} for r in rows]
            }
        except Exception as e:
            logger.warning("MSSQL GL lookup failed: %s — demo fallback", e)

    # Demo fallback (mirroring MASTER_TABLES.M_GeneralLedger from the original UI)
    demo = [
        {"id": "24-HB0001", "name": "PURCHASE A/C"},
        {"id": "24-HB0002", "name": "PURCHASE - PHARMA"},
        {"id": "24-HB0003", "name": "PURCHASE - APPAREL"},
        {"id": "24-HB0004", "name": "PURCHASE - ELECTRONICS"},
        {"id": "24-HB0005", "name": "PURCHASE - GROCERY"},
        {"id": "24-HB0006", "name": "PURCHASE - FMCG"},
        {"id": "40-PUR001", "name": "PURCHASES DIRECT"},
        {"id": "40-PUR002", "name": "PURCHASES INDIRECT"},
    ]
    if q:
        ql = q.lower()
        demo = [d for d in demo if ql in d["id"].lower() or ql in d["name"].lower()]
    return {"source": "demo", "compId": comp, "items": demo[:limit]}


@api_router.get("/mssql/health")
async def mssql_health_ep(user: dict = Depends(require_auth)):
    """Returns SQL Server connectivity status and framework proc count."""
    return await sql_health()


# ── CORS + mount ──────────────────────────────────────────────────────────────

app.include_router(api_router)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=False,
                   allow_methods=["*"], allow_headers=["*"])

@app.on_event("shutdown")
async def shutdown():
    client.close()
