# RetailCLIQ Import — Source-Exact UI Replacement Plan

The zip contains the same RetailCLIQApp that was uploaded previously, now restructured into proper separate React component files instead of one large HTML file. The goal is to replace the current wizard UI with a 1:1 copy of that source — same layout, same labels, same step flow, same options, nothing left out.

## Who It's For
RetailCLIQ implementors and store-ops staff performing Opening Stock migrations.

---

## Core Features and Experience
Every screen, field, toggle, chip, table column, and button visible in the source files must appear in the running app. No feature is dropped. The FastAPI + MongoDB backend stays unchanged; only the frontend is replaced. The MSSQL credentials and all API wiring stay in place.

---

## User Flow
Login → Dashboard → New Import → 9-step wizard (Source / Preview / Mapping / Suppliers / Master Mapping / Validation / Confirm / Import / Result) → Dashboard with batch result.
Every step matches the source React files exactly: same card layout, same field order, same action buttons, same error states, same tile summaries.

---

## UI / UX Feel
Exact copy of the source files. IBM Plex Sans body + IBM Plex Mono terminal/code. Teal (#0f6e74) accent. Sticky header + stepper rail + sticky action bar. Tiles for summary counts. Dark terminal log panel. Nothing invented — if it is in the source, it ships.

---

## Implementation Phases

### Phase 1 — Source Extraction + Full UI Replacement (build now)

1. **Backup** the entire current `/app/frontend/src/` tree into `/app/backend/artifacts_source/backup_current/` so nothing is lost.
2. **Extract** the uploaded zip into `/app/backend/artifacts_source/retailcliq-import-app/`, replacing what is already there.
3. **Read every source file** in the extracted folder — components, pages, hooks, styles, constants.
4. **Replace** the current wizard step components (`/app/frontend/src/components/wizard/Step*.jsx`, `WizardPage.jsx`, `WizardContext.jsx`) with exact ports of the source files: same structure, same props, same UI elements.
5. **Update shared lib files** (`staging.js`, `hbs.js`, `api.js`) if the source versions contain anything the current files do not.
6. **Wire all steps** to the existing FastAPI backend endpoints (upload, begin, rows, validate, gate, post, status, rollback) exactly as they are now — no backend changes.
7. **Verify** the MSSQL status pill still shows "MSSQL · RC26MASTERDB", the 9-step stepper renders correctly, and all buttons and flows work end-to-end with the sample CSV.

### Phase 2 — Live MSSQL Testing
Run a full import end-to-end once the MSSQL server at 120.138.9.33 is reachable from the deployment, confirming proc_StockImportwithSupplier executes.

### Phase 3 — Enhancements
Additional import types (Material Receipt, Purchase Invoice, Franchise MR), NATIVE post mode, mapping template save/load, role-based access.

---

## Assumptions

- The zip source is authoritative for all UI decisions; the current wizard components are replaced, not merged.
- The FastAPI backend, MSSQL credentials, and all API routes remain unchanged.
- The backup destination is `/app/backend/artifacts_source/backup_current/` (overwritten each time this plan runs).
- The extracted source destination is `/app/backend/artifacts_source/retailcliq-import-app/` (replaces existing contents).
- Any source file that imports from a Node/Express path is re-routed to the existing `@/lib/api.js` Axios client.
- Source files that reference environment variables use `process.env.REACT_APP_BACKEND_URL` (already set).
- If the source contains additional steps or sub-panels not in the current wizard, they are added without removal of existing ones.
- Authentication stays as JWT stored in `localStorage` under `rc_token` (already working).
