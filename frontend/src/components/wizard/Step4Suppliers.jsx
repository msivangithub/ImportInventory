import { useState, useEffect, useRef } from 'react';
import { useWizard } from './WizardContext';
import api, { fmtError } from '@/lib/api';
import { toast } from 'sonner';
import { autoMatch, SAMPLE_SUPPLIERS, SUP_FIELDS, supAutoMap, parseCSV } from '@/lib/staging';

const MODES = [
  { id:'column', icon:'≡', label:'From the stock file',  desc:'Distinct values of the mapped Supplier column. New names are created with no outstanding.' },
  { id:'single', icon:'1', label:'Single supplier',      desc:'Franchise / SOR / consignment: the whole opening stock belongs to one supplier.' },
  { id:'file',   icon:'⇪', label:'Upload supplier file', desc:'Separate Excel/CSV with GSTIN, contact, credit days and opening outstanding (Dr/Cr).' },
];

export default function Step4Suppliers() {
  const { ws, patch } = useWizard();
  const sd = ws.suppliersData;

  const [mode,        setMode]        = useState(sd.mode || 'column');
  const [suppliers,   setSuppliers]   = useState(sd.suppliers || []);
  const [singleSel,   setSingleSel]   = useState(sd.singleExisting || '');
  const [singleName,  setSingleName]  = useState(sd.singleName || '');
  const [singleGstin, setSingleGstin] = useState(sd.singleGstin || '');
  const [singleOut,   setSingleOut]   = useState(sd.singleOutstanding || '0');
  const [singleDrCr,  setSingleDrCr]  = useState(sd.singleDrCr || 'Cr');
  const [supCols,     setSupCols]     = useState(sd.supCols || []);
  const [supRows_,    setSupRows_]    = useState(sd.supRows || []);
  const [supMap_,     setSupMap_]     = useState(sd.supMap || {});
  const [supFile,     setSupFile]     = useState(sd.supFile || null);
  const [ledger,      setLedger]      = useState(sd.ledger || { create:true, group:'Sundry Creditors', glType:'S', obDate:'', ifExists:'keep' });
  const fileRef = useRef();

  const masters = ws.masters;
  const vendors = masters?.vendormaster || [];

  // Load masters if not yet loaded
  useEffect(() => {
    if (!masters) {
      api.get('/masters').then(({ data }) => {
        const m = data.masters || data;
        patch({ masters: m });
      }).catch(() => {});
    }
  }, []); // eslint-disable-line

  // Build supplier list from stock file
  useEffect(() => {
    if (mode !== 'column' || !vendors.length) return;
    const { columns, rows, columnMapping } = ws;
    if (!rows?.length) return;
    const supEntry = Object.entries(columnMapping||{}).find(([,v]) => v === 'Supplier');
    if (!supEntry) return;
    const supIdx = columns?.indexOf(supEntry[0]);
    if (supIdx == null || supIdx < 0) return;
    const seen = {};
    rows.forEach(row => { const v = (row[supIdx]||'').trim(); if (v) seen[v] = (seen[v]||0)+1; });
    const newSups = Object.entries(seen).map(([name, rowCount]) => {
      const m = autoMatch(name, vendors);
      const prev = suppliers.find(s => s.name === name);
      return prev || { name, rowCount, decision: m.mode==='existing'?'existing':'new', matchedTo: m.mode==='existing'?m.to:name, matchedId: m.toId, via: m.via };
    });
    setSuppliers(newSups);
  }, [mode, vendors.length, ws.columns, ws.rows, ws.columnMapping]); // eslint-disable-line

  const setDecision = (name, decision, matchedTo, matchedId) =>
    setSuppliers(prev => prev.map(s => s.name===name ? { ...s, decision, matchedTo, matchedId } : s));

  const loadSupFile = (file) => {
    const r = new FileReader();
    r.onload = () => {
      const { columns, rows } = parseCSV(String(r.result));
      setSupCols(columns); setSupRows_(rows); setSupMap_(supAutoMap(columns)); setSupFile(file);
      toast.success(`Parsed ${rows.length} supplier rows`);
    };
    r.readAsText(file);
  };

  // commit nav
  const newCount = suppliers.filter(s => s.decision==='new').length;
  const existingCount = suppliers.filter(s => s.decision==='existing').length;
  const statusText = mode==='column'
    ? suppliers.length ? `${suppliers.length} suppliers: ${newCount} new, ${existingCount} existing`
    : 'Detecting supplier values from file…'
    : mode==='single' ? (singleSel||singleName ? 'Single supplier set' : 'Choose or name the supplier')
    : supFile ? `${supRows_.length} suppliers in file` : 'Upload a supplier file';

  useEffect(() => {
    patch({ nav: { backEnabled:true, nextEnabled:true, nextLabel:'Continue →', statusText } });
  }, [statusText]); // eslint-disable-line

  // commit to context before going next (handled by global Continue button → goNext default)
  useEffect(() => {
    const resolution = {};
    if (mode === 'column') {
      suppliers.forEach(s => {
        if (s.decision==='existing' && s.matchedTo!==s.name) resolution[s.name] = s.matchedTo;
        else if (s.decision==='skip') resolution[s.name] = '';
      });
    } else if (mode === 'single') {
      const val = singleSel && singleSel!=='__new__' ? singleSel : singleName.trim();
      if (val && ws.columns?.length) {
        const supEntry = Object.entries(ws.columnMapping||{}).find(([,v]) => v==='Supplier');
        if (supEntry) {
          const supIdx = ws.columns.indexOf(supEntry[0]);
          const seen = new Set();
          ws.rows?.forEach(row => { const v=(row[supIdx]||'').trim(); if(v) seen.add(v); });
          seen.forEach(v => { resolution[v] = val; });
        }
      }
    }
    patch({ suppliersData: { mode, suppliers, singleName, singleExisting:singleSel, singleGstin, singleOutstanding:singleOut, singleDrCr, supCols, supRows:supRows_, supMap:supMap_, supFile, ledger, resolution } });
  }, [mode, suppliers, singleSel, singleName, singleGstin, singleOut, singleDrCr, supCols, supRows_, supMap_, supFile, ledger]); // eslint-disable-line

  const fmt = n => n == null ? '—' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 });

  return (
    <div className="stack" data-testid="step-suppliers">
      {/* Panel head */}
      <div className="panel-head" style={{ marginBottom:14 }}>
        <div>
          <h2 style={{ fontSize:18, fontWeight:600 }}>Suppliers</h2>
          <p className="muted small">Suppliers are created before the stock so every stock line can point to a <span className="mono">vendormaster</span> row, and each new supplier gets a ledger in <span className="mono">M_GeneralLedger</span> under Sundry Creditors with its opening outstanding.</p>
        </div>
      </div>

      {/* Mode cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:12 }}>
        {MODES.map(m => (
          <button key={m.id} type="button" className={`wz-src ${mode===m.id?'sel':''}`}
            onClick={() => setMode(m.id)} data-testid={`sup-mode-${m.id}`}>
            <span className="ic" style={{ fontSize:18 }}>{m.icon}</span>
            <b style={{ fontSize:14 }}>{m.label}</b>
            <span className="small muted">{m.desc}</span>
          </button>
        ))}
      </div>

      {/* Single supplier */}
      {mode === 'single' && (
        <div className="wz-card stack">
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
            <div className="wz-field">
              <label>Supplier</label>
              <select className="wz-sel" value={singleSel} onChange={e => setSingleSel(e.target.value)}>
                <option value="">— choose from vendormaster —</option>
                {vendors.map(v => <option key={v.id} value={v.name}>{v.name} [{v.id}]</option>)}
                <option value="__new__">+ New supplier…</option>
              </select>
            </div>
            {(!singleSel || singleSel==='__new__') && (
              <div className="wz-field">
                <label>New supplier name</label>
                <input className="wz-inp" value={singleName} onChange={e => setSingleName(e.target.value)}
                  placeholder="e.g. Raymond Apparel (franchisor)" />
              </div>
            )}
            <div className="wz-field">
              <label>GSTIN</label>
              <input className="wz-inp" value={singleGstin} onChange={e => setSingleGstin(e.target.value)}
                placeholder="36AAACR1234A1Z5" />
            </div>
            <div className="wz-field">
              <label>Opening outstanding</label>
              <div className="row">
                <input className="wz-inp" value={singleOut} onChange={e => setSingleOut(e.target.value)}
                  placeholder="0.00" style={{ flex:1 }} />
                <select className="wz-sel" value={singleDrCr} onChange={e => setSingleDrCr(e.target.value)} style={{ width:'auto' }}>
                  <option>Cr</option><option>Dr</option>
                </select>
              </div>
            </div>
          </div>
          <p className="small muted">The Supplier column of every stock row is set to this supplier (overriding any value in the file).</p>
        </div>
      )}

      {/* File upload */}
      {mode === 'file' && (
        <div className="wz-card stack">
          {!supFile ? (
            <div className="wz-drop"
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); if(e.dataTransfer.files[0]) loadSupFile(e.dataTransfer.files[0]); }}
              style={{ cursor:'pointer' }}>
              <b>Drop the supplier file here</b>
              <span className="muted small">Expected columns (any order, any names — they are auto-mapped): Supplier Name, Code, GSTIN, PAN, Mobile, Email, Address, City, State, PIN, Credit Days, Opening Outstanding, Dr/Cr, As On</span>
              <div className="row">
                <label className="wz-btn primary" style={{ cursor:'pointer' }}>
                  Choose file
                  <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" hidden onChange={e => { if(e.target.files[0]) loadSupFile(e.target.files[0]); }} />
                </label>
                <button className="wz-btn" type="button" onClick={e => {
                  e.stopPropagation();
                  const { columns, rows } = parseCSV(SAMPLE_SUPPLIERS);
                  setSupCols(columns); setSupRows_(rows); setSupMap_(supAutoMap(columns));
                  setSupFile({ name:'suppliers_sample.csv' });
                  toast.success(`Sample: ${rows.length} suppliers`);
                }}>Load sample supplier file</button>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', background:'var(--wz-accent-soft)', border:'1px solid var(--wz-accent)', borderRadius:8, marginBottom:10 }}>
                <span>📄</span>
                <b style={{ flex:1 }}>{supFile.name}</b>
                <span className="small muted">{supRows_.length} suppliers</span>
                <button className="wz-btn sm" onClick={() => { setSupFile(null); setSupCols([]); setSupRows_([]); setSupMap_({}); }}>✕</button>
              </div>
              {supCols.length > 0 && (
                <div>
                  <h3 style={{ marginBottom:8 }}>Supplier column mapping</h3>
                  <div style={{ border:'1px solid var(--wz-line)', borderRadius:8, overflow:'hidden' }}>
                    <div className="wz-map-row" style={{ background:'var(--wz-surface-2)' }}>
                      {['Source column','','vendormaster / ledger field',''].map(h => (
                        <div key={h} style={{ fontSize:11, fontWeight:600, color:'var(--wz-fg-3)', textTransform:'uppercase' }}>{h}</div>
                      ))}
                    </div>
                    {supCols.map((col, i) => (
                      <div key={col} className="wz-map-row" style={{ borderTop:'1px solid var(--wz-line)' }}>
                        <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                          <b style={{ fontSize:12 }}>{col}</b>
                          <span style={{ fontSize:11, color:'var(--wz-fg-3)', fontFamily:'var(--wz-font-mono)' }}>{supRows_[0]?.[i] || ''}</span>
                        </div>
                        <div style={{ textAlign:'center', color:'var(--wz-fg-3)' }}>→</div>
                        <select value={supMap_[i]||''} onChange={e => setSupMap_(p => ({ ...p, [i]: e.target.value||undefined }))}
                          className="wz-sel" style={{ height:30, fontSize:11 }}>
                          <option value="">— Ignore —</option>
                          {SUP_FIELDS.map(([k,l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                        <div />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Ledger creation */}
      <div className="wz-card stack" id="supLedger">
        <div className="row" style={{ justifyContent:'space-between' }}>
          <h3>Ledger creation</h3>
          <label className="check small" style={{ display:'flex', gap:8, alignItems:'center', cursor:'pointer', fontSize:12 }}>
            <input type="checkbox" checked={ledger.create}
              onChange={e => setLedger(l => ({ ...l, create: e.target.checked }))}
              style={{ accentColor:'var(--wz-accent)' }} />
            Create ledger in M_GeneralLedger for each new supplier
          </label>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:14 }}>
          <div className="wz-field">
            <label>Ledger group</label>
            <select className="wz-sel" value={ledger.group} onChange={e => setLedger(l => ({ ...l, group:e.target.value }))}>
              <option>Sundry Creditors</option>
              <option>Sundry Creditors - Consignment</option>
              <option>Franchisor Account</option>
              <option>Other Payables</option>
            </select>
          </div>
          <div className="wz-field">
            <label>GlType</label>
            <input className="wz-inp" value={ledger.glType} onChange={e => setLedger(l => ({ ...l, glType:e.target.value }))}
              title="Verify: GlType code used for Sundry Creditors in M_GeneralLedger" />
          </div>
          <div className="wz-field">
            <label>Opening balance as on</label>
            <input type="date" className="wz-inp" value={ledger.obDate} onChange={e => setLedger(l => ({ ...l, obDate:e.target.value }))} />
          </div>
          <div className="wz-field">
            <label>If supplier already exists</label>
            <select className="wz-sel" value={ledger.ifExists} onChange={e => setLedger(l => ({ ...l, ifExists:e.target.value }))}>
              <option value="keep">Keep existing, ignore file outstanding</option>
              <option value="update">Update details, post outstanding</option>
            </select>
          </div>
        </div>
      </div>

      {/* Supplier tiles */}
      {mode === 'column' && suppliers.length > 0 && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))', gap:10 }}>
          {[
            { cls:'n',    v:suppliers.length, l:'Distinct suppliers' },
            { cls:'ok',   v:existingCount,    l:'Matched (existing)' },
            { cls:'info', v:newCount,          l:'Will be created' },
            { cls:'warn', v:suppliers.filter(s=>s.decision==='skip').length, l:'Rows skipped' },
          ].map(t => (
            <div key={t.l} className={`wz-tile ${t.cls}`}>
              <div className="v">{t.v}</div><div className="l">{t.l}</div>
            </div>
          ))}
        </div>
      )}

      {/* Supplier resolution table */}
      {mode === 'column' && (
        <div className="wz-card">
          <div className="row" style={{ justifyContent:'space-between', marginBottom:8 }}>
            <h3>Suppliers in this import</h3>
            <span className="small muted">{suppliers.length} suppliers · <span id="supCount">{mode==='column'?`${newCount} new, ${existingCount} existing`:''}</span></span>
          </div>
          {suppliers.length === 0 ? (
            <p className="small muted" style={{ padding:'16px 0' }}>
              {Object.values(ws.columnMapping||{}).includes('Supplier')
                ? 'Loading supplier values from your file…'
                : '⚠ Supplier column not mapped — go back to Mapping and map a column to "Supplier"'}
            </p>
          ) : (
            <div className="wz-tbl-wrap">
              <table>
                <thead><tr>
                  <th>Supplier</th><th>Code</th><th>GSTIN</th>
                  <th>Status</th><th>Stock rows</th>
                  <th>Outstanding</th><th>Dr/Cr</th><th>Ledger</th><th>Decision</th>
                </tr></thead>
                <tbody>
                  {suppliers.map(sup => (
                    <tr key={sup.name} className={sup.decision==='existing'?'r-ok':sup.decision==='new'?'r-err':''} data-testid={`sup-row-${sup.name}`}>
                      <td><b>{sup.name}</b>{sup.via&&<div style={{ fontSize:10, color:'var(--wz-fg-3)' }}>via {sup.via}</div>}</td>
                      <td className="mono" style={{ fontSize:11 }}>{sup.matchedId||'—'}</td>
                      <td>—</td>
                      <td><span className={`wz-pill ${sup.decision==='existing'?'ok':sup.decision==='new'?'info':'warn'}`}>{sup.decision==='existing'?'Existing':sup.decision==='new'?'Create':'Skip'}</span></td>
                      <td className="num">{sup.rowCount}</td>
                      <td>—</td><td>—</td>
                      <td style={{ fontSize:11 }}>{ledger.create && sup.decision==='new' ? ledger.group : '—'}</td>
                      <td>
                        <div style={{ display:'flex', gap:4, alignItems:'center' }}>
                          <select value={sup.decision} onChange={e => {
                            if (e.target.value==='new') setDecision(sup.name,'new',sup.name,null);
                            else if (e.target.value==='skip') setDecision(sup.name,'skip','',null);
                            else { const m=autoMatch(sup.name,vendors); setDecision(sup.name,'existing',m.to||(vendors[0]?.name||sup.name),m.toId); }
                          }} className="wz-sel" style={{ height:28, fontSize:11, width:120 }}>
                            <option value="existing">Use existing</option>
                            <option value="new">Create new</option>
                            <option value="skip">Skip rows</option>
                          </select>
                          {sup.decision==='existing' && (
                            <select value={sup.matchedTo||''} onChange={e => { const item=vendors.find(v=>v.name===e.target.value); setDecision(sup.name,'existing',e.target.value,item?.id||null); }}
                              className="wz-sel" style={{ height:28, fontSize:11, width:160, borderColor:'var(--wz-accent)' }}>
                              {vendors.map(v => <option key={v.id} value={v.name}>{v.name} [{v.id}]</option>)}
                            </select>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
