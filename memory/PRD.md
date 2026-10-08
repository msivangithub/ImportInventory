# RetailCLIQ Opening Import — PRD & Architecture

## Problem Statement
Full-stack browser-based batch import manager for RetailCLIQ ERP. Enables retail chain implementors and store-ops staff to perform Opening Stock migrations from legacy systems or other RetailCLIQ client databases. Validates every row against 24 business rules before posting to MSSQL in resumable chunks — with full rollback.

## Tech Stack
- **Frontend**: React 19 + Tailwind CSS + Wizard CSS Variables (matching source HTML exactly)
- **Backend**: FastAPI (Python) + MongoDB (internal batch state only — never shown to user)
- **Target DB**: Microsoft SQL Server (MSSQL) via `pymssql` — user's actual working database
- **Auth**: JWT (bcrypt + HS256), stored as `rc_token` in localStorage

## Architecture
```
/app/
├── backend/
│   ├── server.py           # FastAPI — 27 endpoints, MSSQL-aware
│   └── .env                # MONGO_URL, MSSQL credentials
└── frontend/src/
    ├── pages/
    │   ├── WizardPage.jsx  # 9-step React wizard (exact 1:1 port of source HTML)
    │   ├── DashboardPage.js
    │   └── LoginPage.js
    ├── components/wizard/
    │   ├── WizardContext.jsx    # Shared state + nav state + nextHandlerRef
    │   ├── Step1Source.jsx      # Source cards (5) + file upload + parse opts + globalization
    │   ├── Step2Preview.jsx     # Column detection + sample rows
    │   ├── Step3Mapping.jsx     # Field mapping + schema panel + article name builder
    │   ├── Step4Suppliers.jsx   # Supplier resolution + ledger creation
    │   ├── Step5Masters.jsx     # Master mapping + bulk actions + policy card
    │   ├── Step6Validation.jsx  # 24-rule validation + profile note
    │   ├── Step7Confirm.jsx     # Confirm tiles + options + date conversion + T-SQL plan
    │   ├── Step8Import.jsx      # Live posting + phase indicators + Pause/Cancel
    │   └── Step9Result.jsx      # Result + rollback + audit KV + import log
    └── lib/
        ├── api.js               # Axios + JWT interceptor
        ├── staging.js           # COLUMN_DEFS, autoMatch, resolveRow, SAMPLE_STOCK
        ├── hbs.js               # HBS date engine
        └── wizard-constants.js  # REGIONS, BRANCHES, IMPORT_TYPES, PROFILES, MASTER_TABLES_META
```

## MSSQL Configuration (backend/.env)
```
MSSQL_SERVER=120.138.9.33,58842
MSSQL_PORT=58842
MSSQL_USER=sa
MSSQL_PASSWORD=myaccounts_hbs123
MSSQL_DB=RC26MASTERDB
MSSQL_COMP_ID=c001
```

## 9-Step Import Wizard (source-exact)
The wizard is a 1:1 React port of the original `public/index.html` source. Every screen, field, button, tile, and panel matches the source exactly.

| Step | Title | Key UI elements |
|------|-------|----------------|
| 1 | **Source** | 5 source cards (File/API/DB/Legacy/RC→RC), file drop zone, parse options (Delimiter/Encoding/srcDate/srcNum), Target DB cards (Fresh/Running), Globalization section (KV + HBS date calculator) |
| 2 | **Preview** | "First row is header" checkbox, 4 summary tiles, column detection table (#/Source column/Detected type/Filled/Distinct/Sample values), sample rows |
| 3 | **Mapping** | Auto map, Load/Save template, map summary pills, mapping list (source → target + transform), defaults card with rule dropdowns, article name builder, sticky schema panel |
| 4 | **Suppliers** | 3 mode cards (From file/Single/Upload), single supplier fields, supplier file upload + column mapping, ledger creation card, supplier resolution table (9 columns) |
| 5 | **Masters** | Item identity card, 5 summary tiles, policy card (togglable), tabs per master (13 types), filter chips (All/Unresolved/Existing/New/Skip), bulk action bar, mm rows with Existing/Create new/Skip row actions |
| 6 | **Validation** | Industry profile selector, profile note alert (blue), 4 tiles (Rows checked/Clean/Warnings/Errors), filter chips, table (Row/Status/Key/Dates→HBS/Rule checks/Messages), rules applied chips |
| 7 | **Confirm** | 8 summary tiles, import settings KV, options (dup policy/posting/purchase A/c/chunk size/remarks/confirm checkbox), date & number conversion table, T-SQL execution plan (expandable dark terminal) |
| 8 | **Import** | Pause + Cancel buttons, progress bar, phase indicators, tiles, chunk grid, live log (dark terminal) |
| 9 | **Result** | Copy error report + Copy import log buttons, result alert, tiles, audit KV, rollback (with ROLLBACK confirmation), failed rows table (Row/Outcome/Key/Reason), import log |

## Global Layout (exact source match)
- **Sticky header**: RC logo + brand + MSSQL status pill + 4 dropdowns (Import type, Branch context, Region/formats, Language)
- **Sticky stepper**: 9 steps with teal accent for done/current, connector lines
- **Global sticky action bar**: `← Back` | status text | `Continue →` / `Start import`
- **CSS variables**: exact copy from source (`--wz-accent: #0f6e74`, IBM Plex Sans, IBM Plex Mono)

## Backend API (27 endpoints)
| Route | Status |
|-------|--------|
| GET /api/health | ✓ Returns mssqlLive, mssqlDb='RC26MASTERDB', mode='live' when MSSQL configured |
| GET /api/masters | ✓ Returns flat + `masters`-wrapped format (both supported) |
| POST /api/import/upload | ✓ Returns columns, allRows, rows (alias), previewRows |
| POST /api/import/begin | ✓ Creates batch in MongoDB |
| POST /api/import/{id}/rows | ✓ Bulk insert resolved rows |
| POST /api/import/{id}/validate | ✓ 24-rule validation |
| POST /api/import/{id}/gate | ✓ 13 gate checks |
| POST /api/import/{id}/post | ✓ Background chunked posting |
| GET /api/import/{id}/status | ✓ Live status + chunks |
| POST /api/import/{id}/rollback | ✓ Full rollback |
| GET /api/import/{id}/errors | ✓ Paginated errors |
| GET /api/import/{id}/errors/csv | ✓ Error CSV download |
| POST /api/rc/extract | ✓ RetailCLIQ→RetailCLIQ extraction |
| GET /api/dashboard/stats | ✓ Counter cards + batch list |
| POST /api/auth/login | ✓ JWT + bcrypt |

## Test Credentials
- **Email**: msnarayana@retailcliq.com
- **Password**: RetailCLIQ@2026
- **Company**: RetailCLIQ India Pvt Ltd (RCLQ01)
- **Branch**: Head Office — Mumbai (BMS10001) / ONG-CENTRAL [BMS10004]

## Implemented Features (as of 2026-10-07)
- [x] Source-exact React wizard — 1:1 port of source HTML
- [x] 5 source type cards in Step 1
- [x] Parse options (Delimiter, Encoding, Source date format, Source number format)
- [x] Globalization section with HBS date calculator
- [x] All 9 steps with exact panels, cards, and tables
- [x] Global sticky action bar (Back / status / Continue)
- [x] 4 header dropdowns (Import type, Branch context, Region, Language)
- [x] MSSQL status pill shows "MSSQL · RC26MASTERDB"
- [x] Schema panel + article name builder in Mapping step
- [x] 13-master mapping with policy card + full bulk action bar
- [x] Validation table with Dates→HBS + Rule checks columns
- [x] Confirm step: 8 tiles + date conversion table + T-SQL plan
- [x] Import step with Pause/Cancel + phase indicators
- [x] Result step with rollback (ROLLBACK confirmation) + audit KV
- [x] MSSQL credentials wired (120.138.9.33:58842 / RC26MASTERDB)

## Prioritized Backlog
### P1 (Next)
- End-to-end live MSSQL test when server 120.138.9.33 is reachable from deployment
- Step 3 Mapping: template save/load persistence with localStorage
- Step 5 Masters: expose all 13 masters from API (currently 5 returned by backend)

### P2 (Future)
- Phase 2 import types: Material Receipt, Purchase Invoice, Franchise MR
- NATIVE post mode (set-based INSERT…SELECT)
- Audit trail viewer, purge scheduling, role-based access
- i18n (5 languages already defined in source), RTL Arabic support
- Dark mode (CSS variables already support it)
