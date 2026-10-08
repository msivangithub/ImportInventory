import { useState, useRef, useCallback, useEffect } from 'react';
import { useWizard } from './WizardContext';
import { REGIONS, SOURCE_TYPES, LEGACY_SYSTEMS } from '@/lib/wizard-constants';
import { smartAutoMap, SAMPLE_STOCK, parseCSV } from '@/lib/staging';
import { hbsToInt } from '@/lib/hbs';
import api, { fmtError } from '@/lib/api';
import { toast } from 'sonner';
import GlAccountSearch from '@/components/import/GlAccountSearch';

function computeColStats(cols, rows) {
  return cols.map((col, i) => {
    const vals = rows.map(r => (r[i] || '').trim());
    const filled = vals.filter(Boolean).length;
    const distinct = new Set(vals.filter(Boolean)).size;
    const samples = [...new Set(vals.filter(Boolean))].slice(0, 3);
    return { name: col, filled, distinct, samples };
  });
}

export default function Step1Source() {
  const { ws, patch, goNext, setNextHandler } = useWizard();
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [rcMsg, setRcMsg] = useState('Not connected');
  const fileRef = useRef();
  const cfg = ws.config;
  const po  = ws.parseOpts;

  const region = REGIONS[ws.region] || REGIONS['en-IN'];
  const setCfg = (k, v) => patch({ config: { ...cfg, [k]: v } });
  const setPo  = (k, v) => patch({ parseOpts: { ...po, [k]: v } });

  // HBS date calculator
  const [hbsTry, setHbsTry] = useState('');
  const hbsOut = hbsTry ? hbsToInt(new Date(hbsTry)) : null;

  // ── load data after parse ─────────────────────────────────────
  const loadData = useCallback((cols, rows, name, size = 0) => {
    const colStats = computeColStats(cols, rows);
    patch({
      file: { name, size },
      columns: cols,
      rows,
      colStats,
      columnMapping: smartAutoMap(cols),
      transforms: {},
      defaults: {},
    });
    toast.success(`Parsed ${rows.length.toLocaleString('en-IN')} rows from ${name}`);
  }, [patch]);

  // ── file handling ─────────────────────────────────────────────
  const handleFile = useCallback(async (file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx','xls','csv','tsv','txt'].includes(ext)) {
      toast.error('Please upload Excel (.xlsx) or CSV/TSV'); return;
    }
    setUploading(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const { data } = await api.post('/import/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      loadData(data.columns, data.allRows || data.rows || [], data.name, data.size);
    } catch {
      if (!['xlsx','xls'].includes(ext)) {
        const r = new FileReader();
        r.onload = () => { const { columns, rows } = parseCSV(String(r.result)); loadData(columns, rows, file.name, file.size); };
        r.readAsText(file);
      } else toast.error('Could not upload file — check server connection');
    } finally { setUploading(false); }
  }, [loadData]);

  const loadSample = () => {
    const { columns, rows } = parseCSV(SAMPLE_STOCK);
    loadData(columns, rows, 'opening_stock_sample_FY2627.csv', SAMPLE_STOCK.length);
    toast.info('Sample loaded — 18 rows with deliberate errors for testing all 24 rules');
  };

  // ── RC extract ────────────────────────────────────────────────
  const doRcFetch = async () => {
    if (!ws.apiHealth?.mssqlLive) {
      setRcMsg('Extracting from RetailCLIQ source (demo)…');
      setTimeout(() => {
        const { columns, rows } = parseCSV(SAMPLE_STOCK);
        loadData(columns, rows, 'rc_extract_sample.csv');
        setRcMsg('Fetched 18 items (demo mode)');
      }, 700);
      return;
    }
    setRcMsg('Extracting…');
    try {
      const { data } = await api.post('/rc/extract', { branchId: ws.branchId });
      const cols = data.columns || []; const rowData = data.rows || [];
      loadData(cols, rowData, `rc_extract_${data.name || 'data'}.csv`);
      setRcMsg(`Fetched ${rowData.length} items from ${data.name || 'source DB'}`);
    } catch (e) { setRcMsg(`Extract failed: ${fmtError(e)}`); }
  };

  // ── create batch + advance ─────────────────────────────────────
  const doNext = useCallback(async () => {
    const srcOk = ws.source !== 'file' || !!ws.file;
    if (!srcOk) { toast.error('Load a file or test a connection to continue'); return; }
    if (!cfg.purchaseAccount?.trim()) { toast.error('Purchase Account (GL) is required'); return; }
    setCreating(true);
    try {
      const dateOrderEffective = cfg.dateOrder === 'HBS' ? 'DMY' : cfg.dateOrder;
      const { data } = await api.post('/import/begin', {
        importType: cfg.importType || 'STOCK',
        postMode: cfg.postMode || 'LEGACY',
        purchaseAccount: cfg.purchaseAccount,
        dateOrder: dateOrderEffective,
        numberStyle: cfg.numberStyle,
        region: ws.region,
        dupKeyColumns: cfg.dupKeyColumns,
        dupMode: cfg.dupMode,
        dbMode: ws.dbMode === 'fresh' ? 'FRESH' : 'RUNNING',
        chunkSize: Number(cfg.chunkSize),
        remarks: cfg.remarks,
        sourceName: ws.file?.name || ws.source,
      });
      if (ws.file?.name) {
        await api.post(`/import/${data.batchId}/source`, { sourceName: ws.file.name }).catch(() => {});
      }
      patch({ batchId: data.batchId });
      goNext();
      toast.success(`Batch ${data.batchId} created`);
    } catch (e) { toast.error(fmtError(e)); }
    finally { setCreating(false); }
  }, [ws, cfg, patch, goNext]);

  // ── update nav bar ─────────────────────────────────────────────
  const srcReady = ws.source !== 'file' || !!ws.file;
  // Keep a ref so the registered handler always calls the latest doNext (avoids stale closure)
  const doNextRef = useRef(doNext);
  doNextRef.current = doNext;

  useEffect(() => {
    setNextHandler(() => doNextRef.current());
    patch({ nav: {
      backEnabled: false,
      nextEnabled: srcReady && !creating,
      nextLabel: creating ? 'Creating batch…' : 'Continue →',
      statusText: srcReady ? (ws.file ? `${ws.file.name} · ${ws.rows.length.toLocaleString('en-IN')} rows` : 'Source ready') : 'Load a file or test a connection to continue',
    }});
  }, [srcReady, creating, ws.file, ws.rows.length]); // eslint-disable-line

  const PROFILES_SHORT = [
    { k:'generic', l:'Generic retail' }, { k:'apparel', l:'Apparel' }, { k:'pharma', l:'Pharma' },
    { k:'fmcg', l:'Grocery/FMCG' }, { k:'fresh', l:'Fresh' }, { k:'jewellery', l:'Jewellery' }, { k:'electronics', l:'Electronics' },
  ];

  return (
    <div className="stack" data-testid="step-source">
      {/* ── Source type cards ─── */}
      <div>
        <div className="panel-head" style={{ marginBottom:14 }}>
          <div>
            <h2 style={{ fontFamily:'var(--wz-font-body)', fontSize:18 }}>Where is the data coming from?</h2>
            <p className="muted small">Pick a source. For files, drop a CSV or Excel export. The same mapping and validation steps apply to every source.</p>
          </div>
        </div>
        <div className="src-grid" style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:12 }}>
          {SOURCE_TYPES.map(s => (
            <button key={s.id} type="button" className={`wz-src ${ws.source === s.id ? 'sel' : ''}`}
              onClick={() => patch({ source: s.id })} data-testid={`source-${s.id}`}>
              <span className="ic" style={{ fontSize:18 }}>{s.icon}</span>
              <b style={{ fontSize:14 }}>{s.label}</b>
              <span className="small muted">{s.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── File upload area ─── */}
      {ws.source === 'file' && (
        <div className="wz-card stack">
          {!ws.file ? (
            <div className={`wz-drop ${dragging ? 'over' : ''}`} id="drop"
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 16V4m0 0-4 4m4-4 4 4"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>
              </svg>
              <b>Drop your file here</b>
              <span className="muted small">CSV, TSV, TXT or Excel (.xlsx exported as CSV). Max 50 MB. First row must be the header.</span>
              <div className="row">
                <label className="wz-btn primary" style={{ cursor:'pointer' }} data-testid="choose-file-btn">
                  Choose file
                  <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" hidden onChange={e => handleFile(e.target.files[0])} />
                </label>
                <button className="wz-btn" id="loadSample" type="button" onClick={loadSample} data-testid="load-sample-btn">Load sample file</button>
              </div>
            </div>
          ) : (
            <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', background:'var(--wz-accent-soft)', border:'1px solid var(--wz-accent)', borderRadius:8 }}>
              <span style={{ fontSize:20 }}>📄</span>
              <div style={{ flex:1, minWidth:0 }}>
                <b style={{ display:'block', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{ws.file.name}</b>
                <span className="small muted">{ws.rows.length.toLocaleString('en-IN')} rows · {ws.columns.length} columns</span>
              </div>
              <button className="wz-btn sm" onClick={() => patch({ file:null, columns:[], rows:[], colStats:[], columnMapping:{}, transforms:{} })}>✕ Clear</button>
            </div>
          )}
          {uploading && <p className="small muted" style={{ textAlign:'center', color:'var(--wz-accent)' }}>Parsing file…</p>}

          {/* Parse options */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))', gap:14, marginTop:4 }}>
            <div className="wz-field">
              <label>Delimiter</label>
              <select className="wz-sel" value={po.delim} onChange={e => setPo('delim', e.target.value)}>
                <option value="auto">Auto-detect</option>
                <option value=",">Comma ( , )</option>
                <option value=";">Semicolon ( ; )</option>
                <option value={'\t'}>Tab</option>
                <option value="|">Pipe ( | )</option>
              </select>
            </div>
            <div className="wz-field">
              <label>Encoding</label>
              <select className="wz-sel" value={po.encoding} onChange={e => setPo('encoding', e.target.value)}>
                <option>UTF-8</option><option>Windows-1252</option><option>ISO-8859-1</option><option>UTF-16</option>
              </select>
            </div>
            <div className="wz-field">
              <label>Source date format</label>
              <select className="wz-sel" value={po.srcDateFmt} onChange={e => setPo('srcDateFmt', e.target.value)}>
                <option value="auto">Auto (from region)</option>
                <option value="DMY">DD/MM/YYYY</option>
                <option value="MDY">MM/DD/YYYY</option>
                <option value="YMD">YYYY-MM-DD</option>
                <option value="DMMMY">DD-Mon-YYYY</option>
                <option value="HBS">HBS integer</option>
                <option value="EXCEL">Excel serial</option>
              </select>
            </div>
            <div className="wz-field">
              <label>Source number format</label>
              <select className="wz-sel" value={po.srcNumFmt} onChange={e => setPo('srcNumFmt', e.target.value)}>
                <option value="auto">Auto (from region)</option>
                <option value="dot">1,234.56</option>
                <option value="comma">1.234,56</option>
                <option value="space">1 234,56</option>
                <option value="indian">12,34,567.89</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* ── RetailCLIQ→RetailCLIQ ─── */}
      {ws.source === 'rc' && (
        <div className="wz-card stack">
          <h3>RetailCLIQ → RetailCLIQ</h3>
          <p className="small muted">Pull opening stock from a running RetailCLIQ database via <span className="mono">Itemproperties</span> + <span className="mono">Price_Master</span> + <span className="mono">Tax_Master</span>. Masters travel with it.</p>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))', gap:14 }}>
            <div className="wz-field"><label>Source server</label><input className="wz-inp" placeholder="192.168.1.20,1433" /></div>
            <div className="wz-field"><label>Source database</label><input className="wz-inp" placeholder="RC25ERP_LIVE" /></div>
            <div className="wz-field"><label>Source CompId</label><input className="wz-inp" defaultValue="C001" /></div>
            <div className="wz-field"><label>Source branch</label><input className="wz-inp" placeholder="BMS10001 (blank = all)" /></div>
            <div className="wz-field"><label>Stock as on</label><input type="date" className="wz-inp" /></div>
            <div className="wz-field"><label>Item status</label><select className="wz-sel"><option value="A">Active only (status='A')</option><option value="">All</option></select></div>
            <div className="wz-field"><label>Zero-quantity items</label><select className="wz-sel"><option value="skip">Skip (CurQty = 0)</option><option value="include">Include as masters only</option></select></div>
            <div className="wz-field"><label>Master tables</label><select className="wz-sel"><option value="copy">Copy as-is (same ids) — fresh DB</option><option value="map">Map by name into existing masters</option></select></div>
          </div>
          <div className="row">
            <button className="wz-btn primary" onClick={doRcFetch}>Connect &amp; fetch</button>
            <span className="small muted">{rcMsg}</span>
          </div>
        </div>
      )}

      {/* ── API ─── */}
      {ws.source === 'api' && (
        <div className="wz-card stack">
          <h3>API connection</h3>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
            <div className="wz-field"><label>Endpoint URL</label><input className="wz-inp" placeholder="https://erp.example.com/api/v1/items" /></div>
            <div className="wz-field"><label>Authentication</label><select className="wz-sel"><option>Bearer token</option><option>API key header</option><option>Basic auth</option></select></div>
            <div className="wz-field"><label>Token / key</label><input type="password" className="wz-inp" placeholder="••••••••" /></div>
            <div className="wz-field"><label>Records path (JSON)</label><input className="wz-inp" defaultValue="$.data[*]" /></div>
          </div>
          <div className="row">
            <button className="wz-btn" onClick={() => { toast.info('API demo: loading sample data'); loadSample(); }}>Test connection</button>
            <span className="small muted">Not tested</span>
          </div>
        </div>
      )}

      {/* ── Database ─── */}
      {ws.source === 'db' && (
        <div className="wz-card stack">
          <h3>Database connection</h3>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
            <div className="wz-field"><label>Database</label><select className="wz-sel"><option>MS SQL Server</option><option>MySQL</option><option>PostgreSQL</option><option>Oracle</option></select></div>
            <div className="wz-field"><label>Server / host</label><input className="wz-inp" placeholder="192.168.1.20,1433" /></div>
            <div className="wz-field"><label>Database name</label><input className="wz-inp" placeholder="OLD_ERP" /></div>
            <div className="wz-field"><label>User</label><input className="wz-inp" placeholder="sa" /></div>
          </div>
          <div className="wz-field"><label>Query</label><textarea className="wz-inp" rows="3" style={{ fontFamily:'var(--wz-font-mono)', fontSize:12, resize:'vertical' }}>SELECT ItemCode, ItemName, Qty, Rate, Branch FROM OpeningStock WHERE FY='2026-27'</textarea></div>
          <div className="row">
            <button className="wz-btn" onClick={() => { toast.info('DB demo: loading sample data'); loadSample(); }}>Test &amp; fetch preview</button>
            <span className="small muted">Not tested</span>
          </div>
        </div>
      )}

      {/* ── Previous ERP export ─── */}
      {ws.source === 'legacy' && (
        <div className="wz-card stack">
          <h3>Previous ERP export</h3>
          <p className="muted small">Choose the legacy system. Its known column names are pre-mapped so you skip most of manual mapping.</p>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
            <div className="wz-field">
              <label>Legacy system</label>
              <select className="wz-sel">{LEGACY_SYSTEMS.map(s => <option key={s}>{s}</option>)}</select>
            </div>
            <div className="wz-field"><label>Export file</label><input type="file" className="wz-inp" accept=".csv,.tsv,.txt,.xlsx,.xls,.xml" onChange={e => handleFile(e.target.files[0])} /></div>
          </div>
          <button className="wz-btn" onClick={loadSample}>Use sample Tally Prime export</button>
        </div>
      )}

      {/* ── Target database ─── */}
      <div className="wz-card stack" id="dbModeCard">
        <div className="row" style={{ justifyContent:'space-between' }}>
          <div>
            <h3>Target database</h3>
            <p className="small muted">Decides the default decision for every master value that is not found.</p>
          </div>
          <span className={`wz-pill ${ws.dbMode === 'fresh' ? 'info' : 'ok'}`}>{ws.dbMode === 'fresh' ? 'Fresh DB' : 'Running DB'}</span>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          {[
            { id:'fresh',   icon:'✦', label:'Fresh / empty database',  desc:'New implementation. Masters do not exist yet, so every master value defaults to Create new — except suppliers, which come from the Suppliers step.' },
            { id:'running', icon:'▣', label:'Running database',         desc:'Itemmaster and masters already hold data; this stock is added to them. Values default to Existing (matched by name / alias); unmatched ones wait for your decision.' },
          ].map(m => (
            <button key={m.id} type="button" className={`wz-src ${ws.dbMode === m.id ? 'sel' : ''}`}
              onClick={() => patch({ dbMode: m.id, config: { ...cfg, dbMode: m.id.toUpperCase() } })}
              data-testid={`db-mode-${m.id}`}>
              <span className="ic" style={{ fontSize:16 }}>{m.icon}</span>
              <b style={{ fontSize:13 }}>{m.label}</b>
              <span className="small muted">{m.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Globalization & date storage ─── */}
      <div className="wz-card stack" id="globCard">
        <div className="row" style={{ justifyContent:'space-between' }}>
          <h3>Globalization &amp; date storage</h3>
          <span className="wz-pill info">{region.name}</span>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, alignItems:'start' }}>
          <dl className="wz-kv">
            {[
              ['Region',               region.name],
              ['Date input',           `${region.date} · e.g. ${region.date==='DMY'?'31/03/2026':region.date==='MDY'?'03/31/2026':'2026-03-31'}`],
              ['Number input',         region.num==='indian'?'12,34,567.89':region.num==='comma'?'1.234,56':'1,234.56'],
              ['Currency',             `${region.cur} (${region.sym})`],
              ['Time zone',            region.tz],
              ['Financial year starts',region.fy],
              ['Stored as',            'HBS integer, UTC-free (date only)'],
            ].map(([k, v]) => [<dt key={k}>{k}</dt>, <dd key={k+'v'}>{v}</dd>])}
          </dl>
          <div className="stack">
            <div className="eyebrow" style={{ fontSize:11, fontWeight:600, letterSpacing:'.08em', textTransform:'uppercase', color:'var(--wz-fg-3)' }}>HBS date (how RetailCLIQ stores dates)</div>
            <p className="small muted">Every date column is converted to the HBS integer used in the DB: <span className="mono">(year − 1950) × 416 + month × 32 + day</span>. Sources that already contain HBS integers are detected and decoded, so re-importing from an older RetailCLIQ database needs no change.</p>
            <div className="row">
              <input type="date" className="wz-inp" style={{ maxWidth:190 }} value={hbsTry} onChange={e => setHbsTry(e.target.value)} aria-label="Try a date" />
              {hbsOut && <span className="mono" style={{ color:'var(--wz-accent)' }}>→ {hbsOut}</span>}
              {!hbsTry && <span className="small muted">pick a date to see its HBS value</span>}
            </div>
          </div>
        </div>
      </div>

      {/* ── Import settings ─── */}
      <div className="wz-card stack">
        <h3>Import settings</h3>
        {/* Industry profile presets */}
        <div style={{ background:'var(--wz-surface-2)', border:'1px solid var(--wz-line)', borderRadius:6, padding:'8px 12px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <span className="small muted" style={{ whiteSpace:'nowrap' }}>Industry profile:</span>
            {PROFILES_SHORT.map(p => (
              <button key={p.k} type="button" className="wz-chip"
                onClick={() => {
                  const PROF_MAP = { generic:'OEMCode', apparel:'OEMCode,Size,Color', pharma:'OEMCode,BatchNo', fmcg:'OEMCode,BatchNo', fresh:'OEMCode,PackedDate', jewellery:'ItemCode', electronics:'BatchNo' };
                  const PROF_MODE = { generic:'ERROR', apparel:'ALLOW', pharma:'ERROR', fmcg:'WARN', fresh:'ALLOW', jewellery:'ERROR', electronics:'ERROR' };
                  patch({ config: { ...cfg, dupKeyColumns: PROF_MAP[p.k], dupMode: PROF_MODE[p.k] } });
                  toast.success(`Profile "${p.l}" applied`);
                }}
                data-testid={`profile-${p.k}`}>{p.l}</button>
            ))}
          </div>
          <p className="small muted" style={{ marginTop:6 }}>Quick-fills Duplicate Key Columns and Mode below</p>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:14 }}>
          <div className="wz-field">
            <label>Purchase Account <span style={{ color:'var(--wz-err)' }}>*</span></label>
            <GlAccountSearch value={cfg.purchaseAccount} onSelect={v => setCfg('purchaseAccount', v)} />
          </div>
          <div className="wz-field">
            <label>Date Order</label>
            <select className="wz-sel" value={cfg.dateOrder} onChange={e => setCfg('dateOrder', e.target.value)} data-testid="date-order-sel">
              <option value="DMY">DMY — 01/02/2026</option>
              <option value="MDY">MDY — 02/01/2026</option>
              <option value="YMD">YMD — 2026-02-01</option>
              <option value="HBS">HBS integer</option>
            </select>
          </div>
          <div className="wz-field">
            <label>Number Style</label>
            <select className="wz-sel" value={cfg.numberStyle} onChange={e => setCfg('numberStyle', e.target.value)}>
              <option value="DOT">DOT — 1,234.56</option>
              <option value="COMMA">COMMA — 1.234,56</option>
            </select>
          </div>
          <div className="wz-field">
            <label>Duplicate Key Columns</label>
            <input className="wz-inp" value={cfg.dupKeyColumns} onChange={e => setCfg('dupKeyColumns', e.target.value)}
              placeholder="OEMCode" style={{ fontFamily:'var(--wz-font-mono)' }} data-testid="dup-key-input" />
          </div>
          <div className="wz-field">
            <label>Duplicate Mode</label>
            <select className="wz-sel" value={cfg.dupMode} onChange={e => setCfg('dupMode', e.target.value)}>
              <option value="ERROR">ERROR — reject duplicates</option>
              <option value="WARN">WARN — allow with warning</option>
              <option value="ALLOW">ALLOW — silent</option>
            </select>
          </div>
          <div className="wz-field">
            <label>Target DB Mode</label>
            <select className="wz-sel" value={cfg.dbMode || (ws.dbMode === 'fresh' ? 'FRESH' : 'RUNNING')}
              onChange={e => { setCfg('dbMode', e.target.value); patch({ dbMode: e.target.value.toLowerCase() }); }}>
              <option value="RUNNING">RUNNING — existing data</option>
              <option value="FRESH">FRESH — new / empty DB</option>
            </select>
          </div>
          <div className="wz-field">
            <label>Chunk Size</label>
            <select className="wz-sel" value={cfg.chunkSize} onChange={e => setCfg('chunkSize', Number(e.target.value))}>
              <option value={5000}>5,000</option>
              <option value={50000}>50,000 (recommended)</option>
              <option value={100000}>100,000</option>
            </select>
          </div>
          <div className="wz-field" style={{ gridColumn:'span 2' }}>
            <label>Remarks (saved to audit)</label>
            <input className="wz-inp" value={cfg.remarks} onChange={e => setCfg('remarks', e.target.value)}
              placeholder="e.g. Opening stock migration FY 2026-27" />
          </div>
        </div>
      </div>
    </div>
  );
}
