"""
Backend tests for RetailCLIQ 9-step wizard APIs
Tests: health, masters, auth, upload, begin, validate, gate, post, status
"""
import pytest
import requests
import os
import io

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# ── Auth ─────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "msnarayana@retailcliq.com",
        "password": "RetailCLIQ@2026"
    })
    assert r.status_code == 200, f"Login failed: {r.text}"
    return r.json()["token"]

@pytest.fixture(scope="module")
def auth(token):
    s = requests.Session()
    s.headers["Authorization"] = f"Bearer {token}"
    return s

# ── Health ────────────────────────────────────────────────────────────────────

def test_health_endpoint():
    r = requests.get(f"{BASE_URL}/api/health")
    assert r.status_code == 200
    d = r.json()
    assert d.get("ok") is True
    assert "connected" in d
    assert d["connected"] is True  # MongoDB must be up

def test_health_mode(auth):
    r = auth.get(f"{BASE_URL}/api/health")
    d = r.json()
    assert d.get("mode") in ("live", "demo")

# ── Masters ───────────────────────────────────────────────────────────────────

def test_masters_returns_masters_key(auth):
    r = auth.get(f"{BASE_URL}/api/masters")
    assert r.status_code == 200
    d = r.json()
    # Must have top-level "masters" key
    assert "masters" in d, "Missing 'masters' key in response"
    m = d["masters"]
    assert "vendormaster" in m
    assert "UOMMaster" in m
    assert "Tax_Master" in m
    assert "CategoryMaster" in m

def test_masters_flat_keys(auth):
    r = auth.get(f"{BASE_URL}/api/masters")
    d = r.json()
    # Also flat keys for backwards compat
    assert "vendormaster" in d
    assert "UOMMaster" in d
    assert "Tax_Master" in d
    assert "CategoryMaster" in d
    assert "M_GeneralLedger" in d
    assert len(d["M_GeneralLedger"]) >= 1

def test_masters_vendor_data(auth):
    r = auth.get(f"{BASE_URL}/api/masters")
    d = r.json()
    vendors = d["vendormaster"]
    assert len(vendors) >= 1
    assert "id" in vendors[0]
    assert "name" in vendors[0]

# ── Auth ──────────────────────────────────────────────────────────────────────

def test_login_success():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "msnarayana@retailcliq.com",
        "password": "RetailCLIQ@2026"
    })
    assert r.status_code == 200
    d = r.json()
    assert "token" in d
    assert "user" in d
    assert d["user"]["email"] == "msnarayana@retailcliq.com"

def test_login_bad_password():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "msnarayana@retailcliq.com",
        "password": "wrong"
    })
    assert r.status_code == 401

def test_auth_me(auth):
    r = auth.get(f"{BASE_URL}/api/auth/me")
    assert r.status_code == 200
    d = r.json()
    assert "email" in d

# ── Upload ────────────────────────────────────────────────────────────────────

SAMPLE_CSV = """SlNo,OEMCode,ItemDescription,UOMId,Qty,PurchasePrice,MRP,Category,Tax,Supplier,TransDate
1,TEST-001,Test Item One,PCS,10,100,150,GROCERY,TX05,Sri Lakshmi Traders,01/01/2026
2,TEST-002,Test Item Two,KG,5,200,250,DAIRY,TX12,Heritage Foods,01/01/2026
"""

def test_upload_returns_rows(auth):
    """POST /api/import/upload must return rows, allRows, columns, rowCount"""
    files = {"file": ("test.csv", io.BytesIO(SAMPLE_CSV.encode()), "text/csv")}
    r = auth.post(f"{BASE_URL}/api/import/upload", files=files)
    assert r.status_code == 200
    d = r.json()
    assert "columns" in d
    assert "allRows" in d
    assert "rows" in d  # alias field
    assert d["rows"] == d["allRows"]
    assert "rowCount" in d
    assert d["rowCount"] == 2
    assert "previewRows" in d

def test_upload_column_detection(auth):
    files = {"file": ("test.csv", io.BytesIO(SAMPLE_CSV.encode()), "text/csv")}
    r = auth.post(f"{BASE_URL}/api/import/upload", files=files)
    d = r.json()
    assert "OEMCode" in d["columns"]
    assert "ItemDescription" in d["columns"]

# ── Import begin ──────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def batch_id(auth):
    r = auth.post(f"{BASE_URL}/api/import/begin", json={
        "importType": "STOCK", "postMode": "LEGACY",
        "purchaseAccount": "24-HB0001",
        "dateOrder": "DMY", "numberStyle": "DOT",
        "dupKeyColumns": "OEMCode", "dupMode": "ERROR",
        "dbMode": "RUNNING", "chunkSize": 50000,
        "sourceName": "test.csv"
    })
    assert r.status_code == 200, f"begin failed: {r.text}"
    return r.json()["batchId"]

def test_begin_creates_batch(batch_id):
    assert batch_id.startswith("IMP-")

def test_begin_returns_batch_id(auth):
    r = auth.post(f"{BASE_URL}/api/import/begin", json={
        "importType": "STOCK", "purchaseAccount": "24-HB0001",
        "dbMode": "RUNNING", "sourceName": "test2.csv"
    })
    assert r.status_code == 200
    assert "batchId" in r.json()

# ── Rows insert ───────────────────────────────────────────────────────────────

def test_insert_rows(auth, batch_id):
    rows = [
        {"OEMCode": "TEST-001", "ItemDescription": "Test Item One", "UOMId": "PCS",
         "Qty": "10", "PurchasePrice": "100", "MRP": "150",
         "Category": "GROCERY", "Tax": "TX05", "Supplier": "Sri Lakshmi Traders", "TransDate": "01/01/2026"},
        {"OEMCode": "TEST-002", "ItemDescription": "Test Item Two", "UOMId": "KG",
         "Qty": "5", "PurchasePrice": "200", "MRP": "250",
         "Category": "DAIRY", "Tax": "TX12", "Supplier": "Heritage Foods", "TransDate": "01/01/2026"},
    ]
    r = auth.post(f"{BASE_URL}/api/import/{batch_id}/rows", json={"rows": rows, "startRow": 1})
    assert r.status_code == 200
    d = r.json()
    assert d["inserted"] == 2

# ── Validate ──────────────────────────────────────────────────────────────────

def test_validate(auth, batch_id):
    r = auth.post(f"{BASE_URL}/api/import/{batch_id}/validate")
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "Validated"
    assert "totalRows" in d
    assert "rowsValid" in d
    assert "rowsWarn" in d
    assert "rowsError" in d

# ── Gate ──────────────────────────────────────────────────────────────────────

def test_gate(auth, batch_id):
    r = auth.post(f"{BASE_URL}/api/import/{batch_id}/gate", json={"allowErrors": True})
    assert r.status_code == 200
    d = r.json()
    assert "checks" in d
    assert "gate" in d
    assert "gatePassed" in d["gate"]
    assert len(d["checks"]) > 0

# ── Status ────────────────────────────────────────────────────────────────────

def test_batch_status(auth, batch_id):
    r = auth.get(f"{BASE_URL}/api/import/{batch_id}/status")
    assert r.status_code == 200
    d = r.json()
    assert "batch" in d
    assert d["batch"]["batchId"] == batch_id

# ── Dashboard stats ───────────────────────────────────────────────────────────

def test_dashboard_stats(auth):
    r = auth.get(f"{BASE_URL}/api/dashboard/stats")
    assert r.status_code == 200
    d = r.json()
    assert "totalBatches" in d
    assert "batches" in d
    assert isinstance(d["batches"], list)

# ── Prereq ────────────────────────────────────────────────────────────────────

def test_prereq(auth, batch_id):
    r = auth.get(f"{BASE_URL}/api/prereq", params={"batchId": batch_id})
    assert r.status_code == 200
    checks = r.json()
    assert isinstance(checks, list)
    chk_names = [c["chk"] for c in checks]
    assert "UOMMaster has rows" in chk_names
