import { useState } from 'react';
import { useWizard } from './WizardContext';
import { COLUMN_DEFS, REQUIRED, TRANSFORMS, STD_DEFAULTS, smartAutoMap, applyTransform } from '@/lib/staging';
import { toast } from 'sonner';

const CARD = { background:'#fff', border:'1px solid #d3dae1', borderRadius:10, boxShadow:'0 1px 3px rgba(21,32,43,.06)', padding:'18px 20px' };
const BTN_PRIMARY = { background:'#0f6e74', color:'#fff', border:'none', borderRadius:7, padding:'9px 20px', fontSize:13, fontWeight:600, cursor:'pointer' };
const BTN_OUTLINE = { background:'#fff', color:'#4b5a68', border:'1px solid #aab5c0', borderRadius:7, padding:'9px 16px', fontSize:13, fontWeight:500, cursor:'pointer' };
const SEL_BASE = { height:30, fontSize:11, border:'1px solid #d3dae1', borderRadius:5, background:'#fff', fontFamily:'inherit', padding:'0 6px' };

export default function Step3Mapping() {
  const { ws, patch } = useWizard();
  const [showOpt, setShowOpt] = useState(false);
  const { columns, rows, columnMapping, transforms, defaults } = ws;

  const setMap = (col, val) => {
    const cm = { ...columnMapping };
    if (val) cm[col] = val; else delete cm[col];
    patch({ columnMapping: cm });
  };
  const setTr = (col, val) => {
    const t = { ...transforms };
    if (val && val !== 'None') t[col] = val; else delete t[col];
    patch({ transforms: t });
  };
  const setDef = (key, rule) => {
    const d = { ...defaults };
    if (rule) d[key] = { mode: rule, value: '' };
    else delete d[key];
    patch({ defaults: d });
  };
  const setDefVal = (key, value) => {
    patch({ defaults: { ...defaults, [key]: { ...defaults[key], value } } });
  };

  const autoMap = () => {
    patch({ columnMapping: smartAutoMap(columns), transforms: {} });
    toast.success('Auto-mapped ' + Object.keys(smartAutoMap(columns)).length + ' columns');
  };

  const applyStdDefaults = () => {
    const d = { ...defaults };
    let n = 0;
    COLUMN_DEFS.forEach(f => {
      if (Object.values(columnMapping).includes(f.key)) return; // already mapped
      if (d[f.key]) return;
      if (STD_DEFAULTS[f.key]) { d[f.key] = { mode: 'const', value: STD_DEFAULTS[f.key] }; n++; }
    });
    patch({ defaults: d });
    toast.success(`${n} standard defaults applied`);
  };

  const mapped = Object.values(columnMapping).filter(Boolean);
  const missing = REQUIRED.filter(r => !mapped.includes(r) && !defaults[r]);
  const unmappedRequired = COLUMN_DEFS.filter(f => f.req && !mapped.includes(f.key) && !defaults[f.key]);

  const handleNext = () => {
    if (missing.length) { toast.error(`Map required columns first: ${missing.join(', ')}`); return; }
    patch({ step: 3, maxStep: Math.max(ws.maxStep, 3) });
  };

  const previewRows = rows.slice(0, 3);

  return (
    <div style={{display:'flex',flexDirection:'column',gap:16}} data-testid="step-mapping">

      {/* Header + actions */}
      <div style={CARD}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:10,marginBottom:12}}>
          <div>
            <h2 style={{fontSize:16,fontWeight:600,margin:'0 0 3px'}}>Field mapping</h2>
            <p style={{fontSize:12,color:'#7b8894',margin:0}}>Match each source column to a RetailCLIQ staging field. Required fields are marked *</p>
          </div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <button onClick={autoMap} style={BTN_OUTLINE} data-testid="auto-map-btn">Auto map</button>
            <button onClick={applyStdDefaults} style={BTN_OUTLINE}>Apply std defaults</button>
          </div>
        </div>

        {/* Summary pills */}
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:14}}>
          {[
            [mapped.length + ' mapped',       '#1f7a3c', '#dff3e5'],
            [(columns.length - mapped.length) + ' ignored', '#7b8894', '#f3f5f7'],
            [missing.length ? `${missing.length} required missing` : 'All required mapped',
              missing.length ? '#b42323' : '#1f7a3c',
              missing.length ? '#fbe1e1' : '#dff3e5'],
          ].map(([t, color, bg]) => (
            <span key={t} style={{padding:'2px 10px',borderRadius:999,fontSize:11,fontWeight:600,background:bg,color}}>{t}</span>
          ))}
        </div>

        {/* Mapping table */}
        <div style={{border:'1px solid #d3dae1',borderRadius:8,overflow:'hidden'}}>
          {/* Header row */}
          <div style={{display:'grid',gridTemplateColumns:'minmax(0,1.2fr) 24px minmax(0,1.4fr) minmax(0,.9fr)',gap:10,
            padding:'8px 12px',background:'#f3f5f7',borderBottom:'1px solid #d3dae1'}}>
            {['Source column','','RetailCLIQ target','Transform'].map(h => (
              <div key={h} style={{fontSize:10,fontWeight:600,color:'#7b8894',textTransform:'uppercase',letterSpacing:'.05em'}}>{h}</div>
            ))}
          </div>

          <div style={{maxHeight:400,overflowY:'auto'}} className="rc-scrollbar">
            {columns.map((col, i) => {
              const mapped = columnMapping[col];
              const def = COLUMN_DEFS.find(f => f.key === mapped);
              const isReq = def?.req;
              const sample = previewRows.map(r => r[i] || '').filter(Boolean).join(', ');
              const tr = transforms[col];
              const displaySample = tr && tr !== 'None' && previewRows[0]?.[i]
                ? applyTransform(previewRows[0][i], tr) : sample;
              return (
                <div key={col} style={{
                  display:'grid',gridTemplateColumns:'minmax(0,1.2fr) 24px minmax(0,1.4fr) minmax(0,.9fr)',
                  gap:10,padding:'9px 12px',alignItems:'center',
                  borderBottom:'1px solid #f3f5f7',
                  background: isReq ? '#fffef5' : 'transparent',
                }}>
                  <div style={{minWidth:0}}>
                    <div style={{fontWeight:500,fontSize:12,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{col}</div>
                    <div style={{fontSize:10,color:'#7b8894',fontFamily:'"IBM Plex Mono",monospace',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{displaySample}</div>
                  </div>
                  <div style={{textAlign:'center',color:'#aab5c0',fontSize:12}}>→</div>
                  <select value={mapped || ''} onChange={e => setMap(col, e.target.value)}
                    style={{...SEL_BASE, width:'100%', borderColor: isReq ? '#0f6e74' : '#d3dae1'}}
                    data-testid={`map-col-${i}`}>
                    <option value="">(skip / ignore)</option>
                    {COLUMN_DEFS.map(f => (
                      <option key={f.key} value={f.key}>{f.key}{f.req?' *':''}</option>
                    ))}
                  </select>
                  {mapped ? (
                    <select value={tr || 'None'} onChange={e => setTr(col, e.target.value)}
                      style={{...SEL_BASE, width:'100%', color:'#7b8894'}}>
                      {TRANSFORMS.map(t => <option key={t}>{t}</option>)}
                    </select>
                  ) : <span/>}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Defaults card — unmapped required fields */}
      {unmappedRequired.length > 0 && (
        <div style={CARD}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <div>
              <h3 style={{fontSize:13,fontWeight:600,margin:'0 0 2px'}}>Unmapped required fields</h3>
              <p style={{fontSize:11,color:'#7b8894',margin:0}}>These required staging columns are not in your file. Set a default rule for each.</p>
            </div>
            <label style={{display:'flex',alignItems:'center',gap:5,fontSize:11,color:'#4b5a68',cursor:'pointer'}}>
              <input type="checkbox" checked={showOpt} onChange={e => setShowOpt(e.target.checked)} style={{accentColor:'#0f6e74'}} />
              Show optional
            </label>
          </div>

          <div style={{border:'1px solid #fbe1e1',borderRadius:8,overflow:'hidden',background:'#fffef5'}}>
            {(showOpt ? COLUMN_DEFS.filter(f => !Object.values(columnMapping).includes(f.key)) : unmappedRequired).map(f => {
              const d = defaults[f.key] || {};
              return (
                <div key={f.key} style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr)',
                  gap:10,padding:'8px 12px',borderBottom:'1px solid #f3f5f7',alignItems:'center'}}>
                  <div style={{fontSize:12,fontWeight:600,color: f.req ? '#b42323' : '#4b5a68'}}>
                    {f.key}{f.req?' *':''}
                  </div>
                  <select value={d.mode || ''} onChange={e => setDef(f.key, e.target.value)}
                    style={{...SEL_BASE, width:'100%'}} data-testid={`def-mode-${f.key}`}>
                    <option value="">— choose rule —</option>
                    <option value="const">Fixed value</option>
                    <option value="blank">Leave blank</option>
                  </select>
                  {d.mode === 'const' ? (
                    <input value={d.value || ''} onChange={e => setDefVal(f.key, e.target.value)}
                      style={{...SEL_BASE, width:'100%',boxSizing:'border-box'}}
                      placeholder="value" data-testid={`def-val-${f.key}`} />
                  ) : d.mode ? (
                    <span style={{fontSize:11,color:'#7b8894',fontStyle:'italic'}}>→ ''</span>
                  ) : <span style={{fontSize:11,color:'#b42323'}}>needs a rule</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Nav */}
      <div style={{display:'flex',justifyContent:'space-between',paddingTop:4}}>
        <button onClick={() => patch({ step: 1 })} style={BTN_OUTLINE}>← Back</button>
        <button onClick={handleNext} style={{...BTN_PRIMARY, opacity: missing.length > 0 ? 0.55 : 1}}
          data-testid="mapping-next-btn">
          Continue → Suppliers
        </button>
      </div>
    </div>
  );
}
