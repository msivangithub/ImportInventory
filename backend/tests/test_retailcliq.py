"""RetailCLIQ Import API Backend Tests"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
EMAIL = "msnarayana@retailcliq.com"
PASSWORD = "RetailCLIQ@2026"


@pytest.fixture(scope="module")
def token():
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    return resp.json()["token"]


@pytest.fixture(scope="module")
def auth(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


# Auth tests
class TestAuth:
    def test_login_success(self):
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
        assert resp.status_code == 200
        d = resp.json()
        assert "token" in d
        assert d["user"]["email"] == EMAIL

    def test_login_bad_password(self):
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": "wrong"})
        assert resp.status_code == 401

    def test_me_with_token(self, auth):
        resp = auth.get(f"{BASE_URL}/api/auth/me")
        assert resp.status_code == 200
        d = resp.json()
        assert d["email"] == EMAIL

    def test_me_no_token(self):
        resp = requests.get(f"{BASE_URL}/api/auth/me")
        assert resp.status_code == 401


# Masters
class TestMasters:
    def test_masters_returns_all_keys(self, auth):
        resp = auth.get(f"{BASE_URL}/api/masters")
        assert resp.status_code == 200
        d = resp.json()
        assert "vendormaster" in d
        assert "UOMMaster" in d
        assert "Tax_Master" in d
        assert "CategoryMaster" in d
        assert "M_GeneralLedger" in d
        assert len(d["vendormaster"]) > 0
        assert len(d["UOMMaster"]) > 0
        assert len(d["Tax_Master"]) > 0

    def test_masters_unauthorized(self):
        resp = requests.get(f"{BASE_URL}/api/masters")
        assert resp.status_code == 401


# Dashboard
class TestDashboard:
    def test_dashboard_stats(self, auth):
        resp = auth.get(f"{BASE_URL}/api/dashboard/stats")
        assert resp.status_code == 200
        d = resp.json()
        assert "totalBatches" in d
        assert "rowsPostedToday" in d
        assert "errorRate" in d
        assert "activeBatches" in d
        assert "batches" in d
        assert d["totalBatches"] >= 3  # 3 demo batches

    def test_dashboard_has_demo_batches(self, auth):
        resp = auth.get(f"{BASE_URL}/api/dashboard/stats")
        assert resp.status_code == 200
        ids = [b["batchId"] for b in resp.json()["batches"]]
        assert "IMP-20260101-DEMO01" in ids
        assert "IMP-20260115-DEMO02" in ids
        assert "IMP-20260201-DEMO03" in ids


# Pre-req
class TestPrereq:
    def test_prereq_returns_7_items(self, auth):
        resp = auth.get(f"{BASE_URL}/api/prereq")
        assert resp.status_code == 200
        d = resp.json()
        assert len(d) == 7

    def test_prereq_has_phase2_item(self, auth):
        resp = auth.get(f"{BASE_URL}/api/prereq")
        d = resp.json()
        phase2_items = [c for c in d if c["result"] == "PHASE2"]
        assert len(phase2_items) >= 1


# Phase 2
class TestPhase2:
    def test_phase2_returns_9_items(self, auth):
        resp = auth.get(f"{BASE_URL}/api/phase2")
        assert resp.status_code == 200
        d = resp.json()
        assert len(d) == 9

    def test_phase2_areas(self, auth):
        resp = auth.get(f"{BASE_URL}/api/phase2")
        d = resp.json()
        areas = {item["area"] for item in d}
        expected = {"PREFLIGHT", "POSTING", "GST", "SUPPLIER", "VALIDATION", "IMPORTTYPE", "DTO"}
        assert expected == areas


# Import wizard flow
class TestImportFlow:
    batch_id = None

    def test_begin_batch(self, auth):
        resp = auth.post(f"{BASE_URL}/api/import/begin", json={"purchaseAccount": "24-HB0001"})
        assert resp.status_code == 200
        d = resp.json()
        assert "batchId" in d
        TestImportFlow.batch_id = d["batchId"]
        print(f"Created batch: {TestImportFlow.batch_id}")

    def test_upload_csv(self, auth, token):
        csv_content = "ItemDescription,Qty,PurchasePrice,Supplier,Category,Tax\nRice 5kg,10,450,Hindustan Unilever Ltd,Grocery,T002\nSugar 1kg,5,45,ITC Limited,Grocery,T001\nWheat 10kg,20,350,Nestle India,Grocery,T002\n"
        resp = requests.post(f"{BASE_URL}/api/import/upload",
                         files={"file": ("test.csv", csv_content.encode(), "text/csv")},
                         headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        d = resp.json()
        assert "columns" in d
        assert d["rowCount"] == 3

    def test_insert_rows(self, auth):
        bid = TestImportFlow.batch_id
        if not bid:
            pytest.skip("No batch created")
        rows = [
            {"ItemDescription": "Rice 5kg", "Qty": "10", "PurchasePrice": "450", "Supplier": "Hindustan Unilever Ltd", "Category": "Grocery", "Tax": "T002"},
            {"ItemDescription": "Sugar 1kg", "Qty": "5", "PurchasePrice": "45", "Supplier": "ITC Limited", "Category": "Grocery", "Tax": "T001"},
            {"ItemDescription": "Wheat 10kg", "Qty": "20", "PurchasePrice": "350", "Supplier": "Nestle India", "Category": "Grocery", "Tax": "T002"},
        ]
        resp = auth.post(f"{BASE_URL}/api/import/{bid}/rows", json={"rows": rows, "startRow": 1})
        assert resp.status_code == 200
        d = resp.json()
        assert d["inserted"] == 3

    def test_validate_batch(self, auth):
        bid = TestImportFlow.batch_id
        if not bid:
            pytest.skip("No batch created")
        resp = auth.post(f"{BASE_URL}/api/import/{bid}/validate")
        assert resp.status_code == 200
        d = resp.json()
        assert "status" in d
        assert "totalRows" in d

    def test_gate_check(self, auth):
        bid = TestImportFlow.batch_id
        if not bid:
            pytest.skip("No batch created")
        resp = auth.post(f"{BASE_URL}/api/import/{bid}/gate", json={"allowErrors": True})
        assert resp.status_code == 200
        d = resp.json()
        assert "checks" in d
        assert len(d["checks"]) == 13

    def test_batch_status(self, auth):
        bid = TestImportFlow.batch_id
        if not bid:
            pytest.skip("No batch created")
        resp = auth.get(f"{BASE_URL}/api/import/{bid}/status")
        assert resp.status_code == 200
        d = resp.json()
        assert "batch" in d
        assert "chunks" in d

    def test_get_batch(self, auth):
        bid = TestImportFlow.batch_id
        if not bid:
            pytest.skip("No batch created")
        resp = auth.get(f"{BASE_URL}/api/import/{bid}")
        assert resp.status_code == 200
        d = resp.json()
        assert d["batch"]["batchId"] == bid


# Demo batch detail
class TestBatchDetail:
    def test_demo_batch_reconciled(self, auth):
        resp = auth.get(f"{BASE_URL}/api/import/IMP-20260101-DEMO01")
        assert resp.status_code == 200
        d = resp.json()
        assert d["batch"]["status"] == "Reconciled"

    def test_demo_batch_failed(self, auth):
        resp = auth.get(f"{BASE_URL}/api/import/IMP-20260115-DEMO02")
        assert resp.status_code == 200
        d = resp.json()
        assert d["batch"]["status"] == "Failed"

    def test_demo_batch_validated(self, auth):
        resp = auth.get(f"{BASE_URL}/api/import/IMP-20260201-DEMO03")
        assert resp.status_code == 200
        d = resp.json()
        assert d["batch"]["status"] == "Validated"
