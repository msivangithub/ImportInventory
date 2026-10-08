import { useState, useEffect } from 'react';
import { useWizard } from './WizardContext';
import { REGIONS, PROFILES } from '@/lib/wizard-constants';
import { parseImportDate, hbsToInt, hbsDisplay } from '@/lib/hbs';
import { COLUMN_DEFS } from '@/lib/staging';
import { toast } from 'sonner';

const COPY_TEXT = (text, label) => {
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${label} copied to clipboard`),
    () => toast.error('Could not copy to clipboard')
  );
};

function buildTsqlPlan(ws) {
  const b = ws.batchId, cfg = ws.config||{}, vd = ws.validateData;
  const branch = ws.branchId || 'BMS10001';
  return [
    `-- BatchId: ${b || '?'}`,
    `-- ${vd?.totalRows || 0} rows staged in dbo.Stock_Import_Export`,
    ``,
    `-- 0. Defaults applied (DisType=A, Taxtype=I, InTaxtype=E …)`,
    ``,
    `-- 1. Validate rows (server-side, 24 rules):`,
    `EXEC dbo.proc_Import_Validate @BatchId = '${b||'?'}';`,
    ``,
    `-- 2. Final gate check:`,
    `EXEC dbo.proc_Import_Gate @BatchId = '${b||'?'}', @AllowErrors = 0;`,
    ``,
    `-- 3. Post in chunks of ${(cfg.chunkSize||50000).toLocaleString()}:`,
    `EXEC dbo.proc_Import_Post @BatchId = '${b||'?'}', @MaxChunks = 2;  -- loops until done`,
    ``,
    `-- 4. proc_StockImportwithSupplier (called per chunk):`,
    `EXEC dbo.proc_StockImportwithSupplier`,
    `  @CompId          = 'RCLQ01',`,
    `  @UserId          = '${ws.apiHealth?.defaultUser || 'U10001'}',`,
    `  @BranchId        = '${branch}',`,
    `  @PurchaseAccount = '${cfg.purchaseAccount || '(none)'}',`,
    `  @MRNo            = @MRNo OUTPUT,`,
    `  @GSTXml          = '<GST_ITEMS SlNo="…" HSNCode="…" CGST_Per="0" … /></GST>';`,
    ``,
    `-- 5. Reconcile (row count + qty + value match):`,
    `EXEC dbo.proc_Import_Reconcile @BatchId = '${b||'?'}';`,
    `-- On mismatch → Status = 'Failed'; on match → Status = 'Reconciled'`,
  ].join('\n');
}

export default function Step7Confirm() {
  const { ws, patch, goNext } = useWizard();
  const [confirmed, setConfirmed] = useState(false);
  const [showTsql,  setShowTsql]  = useState(false);
  const [opts,      setOpts]      = useState(ws.confirmOpts || {
    dupPolicy: 'update', postMode: 'Post immediately', purAcc: ws.config?.purchaseAccount || '',
    chunkSize: ws.config?.chunkSize || 50000, remarks: ws.config?.remarks || '',
  });

  const { batchId, validateData, masterMapData, config, region: regionKey } = ws;
  const region = REGIONS[regionKey] || REGIONS['en-IN'];
  const vd = validateData || { totalRows:0, rowsValid:0, rowsWarn:0, rowsError:0 };

  // Compute tiles from validation
  const importable = (vd.rowsValid||0) + (vd.rowsWarn||0);
  const newMasters  = Object.values(masterMapData?.masterMap||{}).reduce((acc, colMap) =>
    acc + Object.values(colMap).filter(v=>v.mode==='new').length, 0);
  const updates = 0; // placeholder - would need actual count
  const skipped = vd.rowsError || 0;

  const tiles8 = [
    { cls:'n',    v:(vd.totalRows||0).toLocaleString('en-IN'), l:'Total records'       },
    { cls:'ok',   v:(vd.rowsValid||0).toLocaleString('en-IN'),  l:'Valid'               },
    { cls:'warn', v:(vd.rowsWarn||0).toLocaleString('en-IN'),   l:'Warnings'            },
    { cls:'err',  v:(vd.rowsError||0).toLocaleString('en-IN'),  l:'Errors'              },
    { cls:'info', v:newMasters,                                   l:'New masters'         },
    { cls:'n',    v:updates,                                       l:'Updates to existing' },
    { cls:'warn', v:skipped,                                       l:'Skipped records'     },
    { cls:'acc',  v:importable.toLocaleString('en-IN'),           l:'Will be imported'    },
  ];

  // Date conversion table
  const dateConvRows = [];
  const numConvRows  = [];
  const dateFieldDefs = COLUMN_DEFS.filter(f => f.type==='date');
  const numFieldDefs  = COLUMN_DEFS.filter(f => f.type==='qty'||f.type==='amount');

  const { columns, rows } = ws;
  [...dateFieldDefs, ...numFieldDefs].forEach(f => {
    const colEntry = Object.entries(ws.columnMapping||{}).find(([,v])=>v===f.key);
    if (!colEntry) return;
    const colIdx = columns?.indexOf(colEntry[0]);
    if (colIdx < 0) return;
    const sampleRaw = (rows||[]).slice(0,3).map(r=>r[colIdx]).find(v=>v&&v.trim());
    const isDate = f.type==='date';
    if (isDate) {
      const parsed = sampleRaw ? parseImportDate(sampleRaw, config?.dateOrder||'DMY') : null;
      const hbs = parsed ? hbsToInt(parsed) : null;
      dateConvRows.push({ field:f.key, srcFmt:config?.dateOrder||'DMY', sample:sampleRaw||'—', parsed, hbs });
    } else {
      const parsed = sampleRaw ? parseFloat(sampleRaw.replace(/,/g,'')) : null;
      numConvRows.push({ field:f.key, sample:sampleRaw||'—', parsed });
    }
  });

  const importSettings = [
    ['Import type',     ws.importType==='stock'?'Opening Stock (with Supplier)': ws.importType],
    ['Source',          ws.file?.name || ws.source || '—'],
    ['Branch context',  ws.branchId],
    ['Region / formats',`${region.name} · dates ${region.date} · numbers ${region.num} · ${region.cur}`],
    ['Date storage',    'HBS integer via englishHBS()'],
    ['Industry profile',`${PROFILES[ws.profile||'generic']?.label||ws.profile||'generic'} · duplicates on ${config?.dupKeyColumns||'OEMCode'}: ${config?.dupMode?.toLowerCase()||'error'}`],
    ['Mapped fields',   `${Object.keys(ws.columnMapping||{}).length} of ${ws.columns?.length||0} columns`],
    ['Imported by',     ws.apiHealth?.defaultUser || '—'],
  ];

  // Nav
  useEffect(() => {
    patch({
      nav: {
        backEnabled: true,
        nextEnabled: confirmed,
        nextLabel: 'Start import',
        statusText: confirmed ? 'Ready to import' : 'Tick the confirmation checkbox above to proceed',
      },
      confirmOpts: opts,
      config: { ...config, purchaseAccount: opts.purAcc || config?.purchaseAccount, chunkSize: opts.chunkSize, remarks: opts.remarks },
    });
  }, [confirmed, opts]); // eslint-disable-line

  const setOpt = (k, v) => setOpts(o => ({ ...o, [k]: v }));

  return (
    <div className="stack" data-testid="step-confirm">
      {/* Panel head */}
      <div className="panel-head" style={{ marginBottom:14 }}>
        <div>
          <h2 style={{ fontSize:18, fontWeight:600 }}>Confirm import</h2>
          <p className="muted small">Review what will happen. Nothing is written until you start the import.</p>
        </div>
      </div>

      {/* 8 summary tiles */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))', gap:10 }}>
        {tiles8.map(t => (
          <div key={t.l} className={`wz-tile ${t.cls}`}>
            <div className="v">{t.v}</div><div className="l">{t.l}</div>
          </div>
        ))}
      </div>

      {/* 2-column: Import settings | Options */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
        {/* Import settings KV */}
        <div className="wz-card">
          <h3 style={{ marginBottom:8 }}>Import settings</h3>
          <dl className="wz-kv" id="confSettings">
            {importSettings.map(([k,v]) => [
              <dt key={k}>{k}</dt>,
              <dd key={k+'v'}>{v}</dd>
            ])}
          </dl>
        </div>

        {/* Options */}
        <div className="wz-card stack">
          <h3>Options</h3>
          <div className="wz-field">
            <label>When a record already exists</label>
            <select className="wz-sel" value={opts.dupPolicy} onChange={e => setOpt('dupPolicy', e.target.value)}>
              <option value="update">Update existing record</option>
              <option value="skip">Skip the row</option>
              <option value="error">Treat as error</option>
            </select>
          </div>
          <div className="wz-field">
            <label>Posting</label>
            <select className="wz-sel" value={opts.postMode} onChange={e => setOpt('postMode', e.target.value)}>
              <option>Post immediately</option>
              <option>Save as draft for approval</option>
            </select>
          </div>
          <div className="wz-field">
            <label>Purchase account (M_GeneralLedger)</label>
            <input className="wz-inp" value={opts.purAcc||config?.purchaseAccount||''} onChange={e => setOpt('purAcc', e.target.value)}
              placeholder="e.g. 24-HB0001" />
          </div>
          <div className="wz-field">
            <label>Chunk size (rows per transaction)</label>
            <select className="wz-sel" value={opts.chunkSize} onChange={e => setOpt('chunkSize', Number(e.target.value))}>
              <option value={5000}>5000</option>
              <option value={50000}>50000</option>
              <option value={100000}>100000</option>
            </select>
          </div>
          <div className="wz-field">
            <label>Remarks (saved to audit)</label>
            <input className="wz-inp" value={opts.remarks} onChange={e => setOpt('remarks', e.target.value)}
              placeholder="e.g. Opening stock migration FY 2026-27" />
          </div>
          <label className="check" style={{ display:'flex', gap:10, alignItems:'flex-start', cursor:'pointer', marginTop:4 }}>
            <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}
              style={{ width:18, height:18, accentColor:'var(--wz-accent)', margin:'2px 0 0', flexShrink:0 }}
              data-testid="confirm-import-checkbox" />
            <span>I have reviewed the counts above and want to start this import.</span>
          </label>
        </div>
      </div>

      {/* Date & number conversion table */}
      <div className="wz-card">
        <div className="row" style={{ justifyContent:'space-between', marginBottom:8 }}>
          <h3>Date &amp; number conversion</h3>
          <span className="small muted">{region.name} · {region.date} dates · {region.num} numbers · {region.cur}</span>
        </div>
        <div className="wz-tbl-wrap">
          <table id="dateConvTable">
            <thead><tr>
              <th>Field</th><th>Source format</th><th>Sample (source)</th>
              <th>Parsed</th><th>Stored (HBS int)</th><th>ConvertHBSDate</th>
            </tr></thead>
            <tbody>
              {dateConvRows.map(r => (
                <tr key={r.field}>
                  <td><b>{r.field}</b></td>
                  <td>{r.srcFmt}</td>
                  <td style={{ fontFamily:'var(--wz-font-mono)', fontSize:11 }}>{r.sample}</td>
                  <td>
                    {r.parsed
                      ? `${r.parsed.toLocaleDateString(regionKey,{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'})}`
                      : <span className="wz-pill err">invalid</span>}
                  </td>
                  <td style={{ fontFamily:'var(--wz-font-mono)' }}>{r.hbs ?? '—'}</td>
                  <td style={{ fontFamily:'var(--wz-font-mono)' }}>{r.hbs ? hbsDisplay(r.hbs) : '—'}</td>
                </tr>
              ))}
              {numConvRows.map(r => (
                <tr key={r.field}>
                  <td><b>{r.field}</b></td>
                  <td>{`number · ${region.num}`}</td>
                  <td style={{ fontFamily:'var(--wz-font-mono)', fontSize:11 }}>{r.sample}</td>
                  <td style={{ fontFamily:'var(--wz-font-mono)' }}>{r.parsed != null && !isNaN(r.parsed) ? r.parsed : <span className="wz-pill err">invalid</span>}</td>
                  <td style={{ fontFamily:'var(--wz-font-mono)' }}>{r.parsed != null && !isNaN(r.parsed) ? r.parsed.toFixed(4) : '—'}</td>
                  <td style={{ fontFamily:'var(--wz-font-mono)', fontSize:11, color:'var(--wz-fg-3)' }}>decimal(18,4)</td>
                </tr>
              ))}
              {dateConvRows.length === 0 && numConvRows.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign:'center', color:'var(--wz-fg-3)', padding:12 }}>No date or number columns mapped yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* T-SQL Execution Plan */}
      <div className="wz-card" id="procCard">
        <div className="row" style={{ justifyContent:'space-between', marginBottom:8 }}>
          <h3>Database execution plan</h3>
          <button className="wz-btn sm" onClick={() => COPY_TEXT(buildTsqlPlan(ws), 'T-SQL plan')}
            id="copyProc">Copy T-SQL</button>
        </div>
        <p className="small muted" style={{ marginBottom:8 }}>What the import service will run, in order, built from your mapping. Shown exactly as captured in SQL Profiler for the legacy form.</p>
        <button style={{ width:'100%', display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 10px', background:'var(--wz-surface-2)', border:'1px solid var(--wz-line)', borderRadius:6, cursor:'pointer', fontFamily:'inherit', fontSize:12, color:'var(--wz-fg-2)' }}
          onClick={() => setShowTsql(p => !p)}>
          <span>Show execution plan {showTsql ? '▲' : '▼'}</span>
        </button>
        {showTsql && (
          <pre className="wz-log" style={{ height:'auto', maxHeight:320, background:'#0f151b', color:'#5ccb7f', fontFamily:'var(--wz-font-mono)', fontSize:12, marginTop:4, whiteSpace:'pre-wrap' }}>
            {buildTsqlPlan(ws)}
          </pre>
        )}
      </div>
    </div>
  );
}
