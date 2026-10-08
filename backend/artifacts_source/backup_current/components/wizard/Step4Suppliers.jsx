import { useState, useEffect, useRef } from 'react';
import { useWizard } from './WizardContext';
import api, { fmtError } from '@/lib/api';
import { toast } from 'sonner';
import { autoMatch, SAMPLE_SUPPLIERS, SUP_FIELDS, supAutoMap, parseCSV } from '@/lib/staging';

const CARD = { background:'#fff', border:'1px solid #d3dae1', borderRadius:10, boxShadow:'0 1px 3px rgba(21,32,43,.06)', padding:'18px 20px' };
const BTN_PRIMARY = { background:'#0f6e74', color:'#fff', border:'none', borderRadius:7, padding:'9px 20px', fontSize:13, fontWeight:600, cursor:'pointer' };
const BTN_OUTLINE = { background:'#fff', color:'#4b5a68', border:'1px solid #aab5c0', borderRadius:7, padding:'9px 16px', fontSize:13, fontWeight:500, cursor:'pointer' };
const SEL_BASE = { height:34, fontSize:12, border:'1px solid #d3dae1', borderRadius:6, background:'#fff', fontFamily:'inherit', padding:'0 8px', width:'100%' };

const MODES = [
  { id:'column', icon:'≡', label:'From the stock file',  desc:'Distinct values of the mapped Supplier column.' },
  { id:'single', icon:'①', label:'Single supplier',      desc:'All stock belongs to one supplier (franchise / SOR).' },
  { id:'file',   icon:'⇪', label:'Upload supplier file', desc:'Separate CSV with GSTIN, credit days, outstanding.' },
];

export default function Step4Suppliers() {
  const { ws, patch } = useWizard();
  const sd = ws.suppliersData;

  const [mode, setMode] = useState(sd.mode || 'column');
  const [suppliers, setSuppliers] = useState(sd.suppliers || []);
  const [singleName, setSingleName] = useState(sd.singleName || '');
  const [singleExisting, setSingleExisting] = useState(sd.singleExisting || '');
  const [supCols, setSupCols] = useState([]);
  const [supRows, setSupRows] = useState([]);
  const [supMap, setSupMap] = useState({});
  const [supFile, setSupFile] = useState(null);
  const fileRef = useRef();

  // Use masters from context, fall back to API
  const [apiMasters, setApiMasters] = useState(ws.masters);
  useEffect(() => {
    if (ws.masters) { setApiMasters(ws.masters); return; }
    api.get('/masters').then(({ data }) => setApiMasters(data.masters || data)).catch(() => {});
  }, [ws.masters]);

  // Build supplier list from stock file
  useEffect(() => {
    if (!apiMasters || mode !== 'column') return;
    const { columns, rows: allRows, columnMapping } = ws;
    if (!allRows?.length) return;
    const supColEntry = Object.entries(columnMapping || {}).find(([, v]) => v === 'Supplier');
    if (!supColEntry) return;
    const supIdx = columns?.indexOf(supColEntry[0]);
    if (supIdx == null || supIdx < 0) return;
    const seen = {};
    allRows.forEach(row => { const v = (row[supIdx] || '').trim(); if (v) seen[v] = (seen[v] || 0) + 1; });
    const vendors = apiMasters.vendormaster || [];
    const newSups = Object.entries(seen).map(([name, rowCount]) => {
      const m = autoMatch(name, vendors);
      return { name, rowCount, decision: m.mode === 'existing' ? 'existing' : 'new', matchedTo: m.mode === 'existing' ? m.to : name, matchedId: m.toId, via: m.via };
    });
    setSuppliers(prev => newSups.map(s => prev.find(p => p.name === s.name) || s));
  }, [apiMasters, ws.columns, ws.rows, ws.columnMapping, mode]);

  const setDecision = (name, decision, matchedTo, matchedId) =>
    setSuppliers(prev => prev.map(s => s.name === name ? { ...s, decision, matchedTo, matchedId } : s));

  const loadSupFile = (file) => {
    const r = new FileReader();
    r.onload = () => {
      const { columns, rows } = parseCSV(String(r.result));
      setSupCols(columns); setSupRows(rows); setSupMap(supAutoMap(columns)); setSupFile(file);
      toast.success(`Parsed ${rows.length} supplier rows`);
    };
    r.readAsText(file);
  };

  const handleNext = () => {
    const resolution = {};
    if (mode === 'column') {
      suppliers.forEach(s => {
        if (s.decision === 'existing' && s.matchedTo !== s.name) resolution[s.name] = s.matchedTo;
        else if (s.decision === 'skip') resolution[s.name] = '';
      });
    } else if (mode === 'single') {
      const val = singleExisting && singleExisting !== '__new__' ? singleExisting : singleName.trim();
      if (!val) { toast.error('Select or enter a supplier name'); return; }
      const { columns, rows: allRows, columnMapping } = ws;
      const supColEntry = Object.entries(columnMapping || {}).find(([, v]) => v === 'Supplier');
      if (supColEntry) {
        const supIdx = columns?.indexOf(supColEntry[0]);
        const seen = new Set();
        allRows?.forEach(row => { const v = (row[supIdx] || '').trim(); if (v) seen.add(v); });
        seen.forEach(v => { resolution[v] = val; });
      }
    }
    patch({ suppliersData: { mode, suppliers, singleName, singleExisting, resolution }, step: ws.step + 1, maxStep: Math.max(ws.maxStep, ws.step + 1) });
  };

  const vendors = apiMasters?.vendormaster || [];
  const newCount = suppliers.filter(s => s.decision === 'new').length;
  const existingCount = suppliers.filter(s => s.decision === 'existing').length;

  return (
    <div style={{display:'flex',flexDirection:'column',gap:16}} data-testid="step-suppliers">
      <div style={CARD}>
        <h2 style={{fontSize:16,fontWeight:600,margin:'0 0 3px'}}>Suppliers</h2>
        <p style={{fontSize:12,color:'#7b8894',margin:'0 0 16px'}}>Resolve supplier values — new ones will be created in vendormaster</p>

        {/* Mode cards */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:16}}>
          {MODES.map(m => (
            <button key={m.id} type="button" onClick={() => setMode(m.id)}
              style={{
                textAlign:'left',borderRadius:10,border:`2px solid ${mode===m.id?'#0f6e74':'#d3dae1'}`,
                padding:12,background:mode===m.id?'#dcf1f1':'#fff',cursor:'pointer',transition:'all .15s',
              }}
              data-testid={`sup-mode-${m.id}`}>
              <div style={{fontSize:18,marginBottom:6,color:mode===m.id?'#0f6e74':'#7b8894'}}>{m.icon}</div>
              <p style={{fontSize:12,fontWeight:600,margin:'0 0 3px'}}>{m.label}</p>
              <p style={{fontSize:11,color:'#7b8894',margin:0,lineHeight:1.4}}>{m.desc}</p>
            </button>
          ))}
        </div>

        {/* Single supplier */}
        {mode === 'single' && (
          <div style={{background:'#f3f5f7',border:'1px solid #d3dae1',borderRadius:8,padding:14,display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div>
              <label style={{fontSize:11,fontWeight:600,color:'#4b5a68',display:'block',marginBottom:4}}>Select existing supplier</label>
              <select value={singleExisting} onChange={e => setSingleExisting(e.target.value)} style={SEL_BASE}>
                <option value="">— Choose from vendormaster —</option>
                <option value="__new__">+ Create new supplier…</option>
                {vendors.map(v => <option key={v.id} value={v.name}>{v.name} [{v.id}]</option>)}
              </select>
            </div>
            {(!singleExisting || singleExisting === '__new__') && (
              <div>
                <label style={{fontSize:11,fontWeight:600,color:'#4b5a68',display:'block',marginBottom:4}}>New supplier name</label>
                <input value={singleName} onChange={e => setSingleName(e.target.value)}
                  style={{...SEL_BASE,boxSizing:'border-box'}} placeholder="e.g. Raymond Apparel" />
              </div>
            )}
          </div>
        )}

        {/* Supplier file upload */}
        {mode === 'file' && (
          <div>
            {!supFile ? (
              <div onClick={() => fileRef.current?.click()}
                style={{border:'2px dashed #aab5c0',borderRadius:8,padding:'24px 16px',textAlign:'center',cursor:'pointer'}}>
                <p style={{fontSize:13,fontWeight:500,margin:'0 0 4px'}}>Drop supplier file or <span style={{color:'#0f6e74',textDecoration:'underline'}}>browse</span></p>
                <p style={{fontSize:11,color:'#7b8894',margin:'0 0 12px'}}>Expected: Supplier Name, Code, GSTIN, Outstanding, Dr/Cr</p>
                <div style={{display:'flex',gap:8,justifyContent:'center'}}>
                  <button type="button" style={BTN_PRIMARY}>Choose file</button>
                  <button type="button" onClick={e => {
                    e.stopPropagation();
                    const { columns, rows } = parseCSV(SAMPLE_SUPPLIERS);
                    setSupCols(columns); setSupRows(rows); setSupMap(supAutoMap(columns)); setSupFile({ name: 'suppliers_sample.csv' });
                    toast.success(`Sample: ${rows.length} suppliers`);
                  }} style={BTN_OUTLINE}>Load sample</button>
                </div>
                <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{display:'none'}}
                  onChange={e => { if (e.target.files[0]) loadSupFile(e.target.files[0]); }} />
              </div>
            ) : (
              <div>
                <div style={{display:'flex',alignItems:'center',gap:8,background:'#dcf1f1',border:'1px solid #0f6e7444',borderRadius:8,padding:10,marginBottom:10}}>
                  <span>📄</span>
                  <span style={{fontSize:12,fontWeight:500}}>{supFile.name}</span>
                  <span style={{fontSize:11,color:'#4b5a68'}}>{supRows.length} suppliers</span>
                  <button onClick={() => { setSupFile(null); setSupCols([]); setSupRows([]); setSupMap({}); }}
                    style={{marginLeft:'auto',background:'none',border:'none',cursor:'pointer',color:'#7b8894',fontSize:14}}>✕</button>
                </div>
                {supCols.length > 0 && (
                  <div style={{border:'1px solid #d3dae1',borderRadius:8,overflow:'hidden'}}>
                    <div style={{background:'#f3f5f7',padding:'7px 12px',fontSize:10,fontWeight:600,color:'#7b8894',textTransform:'uppercase',borderBottom:'1px solid #d3dae1'}}>Supplier column mapping</div>
                    <div style={{maxHeight:160,overflowY:'auto'}} className="rc-scrollbar">
                      {supCols.map((col, i) => (
                        <div key={col} style={{display:'flex',alignItems:'center',gap:10,padding:'6px 12px',borderBottom:'1px solid #f3f5f7',fontSize:11}}>
                          <span style={{flex:1,fontWeight:500}}>{col}</span>
                          <span style={{color:'#aab5c0',minWidth:60}}>{supRows[0]?.[i] || '—'}</span>
                          <select value={supMap[i] || ''} onChange={e => setSupMap(p => ({ ...p, [i]: e.target.value || undefined }))}
                            style={{...SEL_BASE,width:160,height:28,fontSize:11}}>
                            <option value="">— Ignore —</option>
                            {SUP_FIELDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Column mode — supplier resolution */}
        {mode === 'column' && (
          <div>
            {suppliers.length > 0 && (
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:12}}>
                {[
                  [suppliers.length, 'Suppliers in file',  '#15202b', '#f3f5f7'],
                  [existingCount,    'Matched (existing)', '#1f7a3c', '#dff3e5'],
                  [newCount,         'Will be created',    '#2457a8', '#e0eafb'],
                ].map(([v, l, color, bg]) => (
                  <div key={l} style={{border:'1px solid',borderColor:bg,background:bg,borderRadius:8,padding:'10px 14px',textAlign:'center'}}>
                    <div style={{fontSize:20,fontWeight:700,color}}>{v}</div>
                    <div style={{fontSize:11,color:'#7b8894',marginTop:2}}>{l}</div>
                  </div>
                ))}
              </div>
            )}

            {suppliers.length > 0 ? (
              <div style={{border:'1px solid #d3dae1',borderRadius:8,overflow:'hidden'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',background:'#f3f5f7',borderBottom:'1px solid #d3dae1'}}>
                  <span style={{fontSize:10,fontWeight:600,color:'#7b8894',textTransform:'uppercase'}}>Supplier resolution</span>
                  <div style={{display:'flex',gap:6}}>
                    <button onClick={() => setSuppliers(p => p.map(s => ({ ...s, decision:'new', matchedTo:s.name, matchedId:null })))}
                      style={{fontSize:11,padding:'2px 8px',border:'1px solid #d3dae1',borderRadius:4,background:'#fff',cursor:'pointer'}}>All → Create new</button>
                    {vendors.length > 0 && (
                      <button onClick={() => {
                        setSuppliers(p => p.map(s => { const m = autoMatch(s.name, vendors); return m.mode === 'existing' ? { ...s, decision:'existing', matchedTo:m.to, matchedId:m.toId } : s; }));
                        toast.success('Re-applied fuzzy matching');
                      }} style={{fontSize:11,padding:'2px 8px',border:'1px solid #d3dae1',borderRadius:4,background:'#fff',cursor:'pointer'}}>Re-match</button>
                    )}
                  </div>
                </div>
                <div style={{maxHeight:280,overflowY:'auto'}} className="rc-scrollbar">
                  {suppliers.map(sup => (
                    <div key={sup.name} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderBottom:'1px solid #f3f5f7',background:sup.decision==='existing'?'#f9fffe':'#fff'}}
                      data-testid={`sup-row-${sup.name}`}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{sup.name}</div>
                        <div style={{fontSize:10,color:'#7b8894'}}>{sup.rowCount} row{sup.rowCount !== 1 ? 's' : ''}{sup.via ? ` · via ${sup.via}` : ''}</div>
                      </div>
                      <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
                        <select value={sup.decision} onChange={e => {
                          if (e.target.value === 'new') setDecision(sup.name,'new',sup.name,null);
                          else if (e.target.value === 'skip') setDecision(sup.name,'skip','',null);
                          else { const m = autoMatch(sup.name, vendors); setDecision(sup.name,'existing',m.to||(vendors[0]?.name||''),m.toId); }
                        }} style={{...SEL_BASE,width:130,height:28,fontSize:11}}>
                          <option value="existing">Use existing</option>
                          <option value="new">Create new</option>
                          <option value="skip">Skip rows</option>
                        </select>
                        {sup.decision === 'existing' && (
                          <select value={sup.matchedTo || ''} onChange={e => { const m = vendors.find(v => v.name === e.target.value); setDecision(sup.name,'existing',e.target.value,m?.id||null); }}
                            style={{...SEL_BASE,width:170,height:28,fontSize:11,borderColor:'#0f6e74'}}>
                            {vendors.map(v => <option key={v.id} value={v.name}>{v.name} [{v.id}]</option>)}
                          </select>
                        )}
                        {sup.decision === 'new' && <span style={{fontSize:10,padding:'2px 8px',borderRadius:999,background:'#e0eafb',color:'#2457a8',whiteSpace:'nowrap'}}>+ Create</span>}
                        {sup.decision === 'skip' && <span style={{fontSize:10,padding:'2px 8px',borderRadius:999,background:'#fbeed3',color:'#a4620a',whiteSpace:'nowrap'}}>{sup.rowCount} skipped</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{background:'#f3f5f7',border:'1px dashed #d3dae1',borderRadius:8,padding:24,textAlign:'center',fontSize:12,color:'#7b8894'}}>
                {Object.values(ws.columnMapping || {}).includes('Supplier')
                  ? 'Loading supplier values…'
                  : '⚠ Supplier column not mapped — go back to Mapping and map a column to "Supplier"'}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{display:'flex',justifyContent:'space-between',paddingTop:4}}>
        <button onClick={() => patch({ step: ws.step - 1 })} style={BTN_OUTLINE}>← Back</button>
        <button onClick={handleNext} style={BTN_PRIMARY} data-testid="wizard-suppliers-next">Continue → Masters</button>
      </div>
    </div>
  );
}
