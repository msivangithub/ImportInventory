import { useState, useEffect, useCallback } from 'react';
import { useWizard } from './WizardContext';
import { COLUMN_DEFS, REQUIRED, TRANSFORMS, STD_DEFAULTS, smartAutoMap, applyTransform } from '@/lib/staging';
import { toast } from 'sonner';

const NORM = s => String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');

// Schema catalog: shows Stock_Import_Export columns in the right panel
const SCHEMA_GROUPS = [
  { name:'Stock_Import_Export', kind:'staging', desc:'Staging table the legacy form bulk-inserts into (DELETE FROM … then insert bulk).', dep:'→ proc_StockImportwithSupplier — reads staging → writes Itemmaster, Price_Master, Invtransaction, GST' },
  { name:'Itemmaster',          kind:'table',   desc:'Item identity (Itemcode PK, OEMCode) plus FK ids to the attribute masters.' },
  { name:'Invtransaction',      kind:'table',   desc:'Inventory ledger written by proc_StockImportwithSupplier. Dates stored as HBS int.' },
  { name:'vendormaster',        kind:'table',   desc:'Suppliers. Status_id=\'S\' = active.' },
  { name:'proc_StockImportwithSupplier', kind:'proc', desc:'Params: @CompId, @UserId, @BranchId, @PurchaseAccount, @MRNo output, @GSTXml.' },
];

const ART_PRESETS = [
  { label:'Apparel',     pattern:'{Brand} {Category} {Style} {Color} {Size}' },
  { label:'Footwear',    pattern:'{Brand} {Category} {Color} {Size}' },
  { label:'Jewellery',   pattern:'{Category} {Design} {Verticle1}' },
  { label:'Pharma',      pattern:'{Brand} {ItemDescription}' },
  { label:'Grocery / FMCG', pattern:'{Brand} {Category}' },
  { label:'Code + name', pattern:'{OEMCode} {ItemDescription}' },
];
const ART_TOKENS = ['Brand','Category','SubCategory','Division','Department','Style','Design','Color','Size','Fabric','UOMId','OEMCode','ItemCode','Verticle1','Verticle2','Verticle3','Supplier'];

export default function Step3Mapping() {
  const { ws, patch } = useWizard();
  const [showOpt,    setShowOpt]    = useState(false);
  const [schemaOpen, setSchemaOpen] = useState('Stock_Import_Export');
  const [schemaQ,    setSchemaQ]    = useState('');
  const [artPat,     setArtPat]     = useState('{Brand} {Category} {Style} {Color} {Size}');
  const [artCase,    setArtCase]    = useState('upper');
  const [artSep,     setArtSep]     = useState(' ');
  const [artTarget,  setArtTarget]  = useState('ItemDescription');
  const [artOverride,setArtOverride]= useState(false);
  const [templates,  setTemplates]  = useState({});

  const { columns, rows, columnMapping, transforms, defaults } = ws;

  const setMap = (col, val) => {
    const cm = { ...columnMapping };
    if (val) cm[col] = val; else delete cm[col];
    patch({ columnMapping: cm, masterMapData: { resolution:{}, masterMap:null, initialized:false } });
  };
  const setTr = (col, val) => {
    const t = { ...transforms };
    if (val && val !== 'None') t[col] = val; else delete t[col];
    patch({ transforms: t });
  };
  const setDef = (key, mode, value='') => {
    const d = { ...defaults };
    if (!mode) { delete d[key]; } else { d[key] = { mode, value }; }
    patch({ defaults: d });
  };
  const setDefVal = (key, value) => patch({ defaults: { ...defaults, [key]: { ...defaults[key], value } } });

  const autoMap = () => {
    const m = smartAutoMap(columns);
    patch({ columnMapping: m, masterMapData: { resolution:{}, masterMap:null, initialized:false } });
    toast.success('Auto-mapped ' + Object.keys(m).length + ' columns');
  };

  const applyStdDefaults = () => {
    const d = { ...defaults };
    let n = 0;
    COLUMN_DEFS.forEach(f => {
      if (Object.values(columnMapping).includes(f.key)) return;
      if (d[f.key]) return;
      if (STD_DEFAULTS[f.key]) { d[f.key] = { mode:'const', value: STD_DEFAULTS[f.key] }; n++; }
    });
    patch({ defaults: d });
    toast.success(`${n} standard defaults applied`);
  };

  const saveTpl = () => {
    const name = `${ws.importType} · ${ws.file?.name?.replace(/\.[^.]+$/,'') || 'mapping'} · ${new Date().toLocaleDateString('en-IN')}`;
    const byName = {};
    Object.entries(columnMapping).forEach(([col, key]) => { byName[col] = key; });
    const updated = { ...templates, [name]: { byName, transforms, defaults, saved: Date.now() } };
    setTemplates(updated);
    try { localStorage.setItem('rc_tpls_stock', JSON.stringify(updated)); } catch {}
    toast.success(`Template saved: ${name}`);
  };

  const applyArt = () => {
    const d = { ...defaults };
    const targets = artTarget === 'both' ? ['ItemDescription','ArtName'] : [artTarget];
    targets.forEach(k => {
      d[k] = { mode:'compose', value: artPat, artCase, artSep, override: artOverride };
    });
    patch({ defaults: d });
    toast.success(`Article name pattern applied to ${targets.join(' and ')}`);
  };

  // Map summary
  const mapped = Object.values(columnMapping).filter(Boolean);
  const defaulted = Object.keys(defaults).filter(k => !mapped.includes(k));
  const missing = REQUIRED.filter(r => !mapped.includes(r) && !defaults[r]);

  // Preview rows for article builder
  const artPreview = rows.slice(0,4).map(row => {
    if (!artPat) return '(empty)';
    let s = artPat;
    ART_TOKENS.forEach(tok => {
      const colEntry = Object.entries(columnMapping).find(([,v]) => v === tok);
      const val = colEntry ? (row[columns.indexOf(colEntry[0])] || '') : (defaults[tok]?.value || '');
      s = s.replace(new RegExp(`\\{${tok}\\}`, 'g'), val);
    });
    s = s.replace(/\{[^}]+\}/g, '').replace(/\s+/g, ' ').trim();
    if (artCase === 'upper') s = s.toUpperCase();
    else if (artCase === 'title') s = s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    return s || '(empty — no tokens resolved)';
  });

  // Nav
  useEffect(() => {
    patch({ nav: {
      backEnabled: true,
      nextEnabled: missing.length === 0,
      nextLabel: 'Continue →',
      statusText: missing.length > 0 ? `${missing.length} required fields unmapped` : `${mapped.length} mapped · ${columns.length - mapped.length} ignored · ${defaulted.length} defaulted`,
    }});
  }, [missing.length, mapped.length, columns.length, defaulted.length]); // eslint-disable-line

  const mapSummaryPills = [
    { cls:'ok',  t:`${mapped.length} mapped` },
    { cls:'n',   t:`${columns.length - mapped.length} ignored` },
    { cls:'info',t:`${defaulted.length} defaulted` },
    missing.length
      ? { cls:'err', t:`${missing.length} required missing` }
      : { cls:'ok',  t:`All required mapped` },
    { cls:'info', t:`Target: Stock_Import_Export → proc_StockImportwithSupplier` },
  ];

  const schemaColsFor = (name) => COLUMN_DEFS.filter(c => !c.inferred || name !== 'Stock_Import_Export');

  const filteredCols = schemaQ
    ? COLUMN_DEFS.filter(c => NORM(c.key).includes(NORM(schemaQ)) || NORM(c.label || '').includes(NORM(schemaQ)))
    : null;

  return (
    <div className="stack" data-testid="step-mapping">
      {/* Panel head */}
      <div className="panel-head" style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, flexWrap:'wrap', marginBottom:14 }}>
        <div>
          <h2 style={{ fontSize:18, fontWeight:600 }}>Field mapping</h2>
          <p className="muted small">Match each source column to a RetailCLIQ field. Required fields are marked <span style={{ color:'var(--wz-err)', fontWeight:600 }}>*</span>.</p>
        </div>
        <div className="row">
          <button className="wz-btn" onClick={autoMap} data-testid="auto-map-btn">Auto map</button>
          <select className="wz-sel" style={{ width:'auto', minWidth:170 }}
            onChange={e => {
              const t = JSON.parse(localStorage.getItem('rc_tpls_stock') || '{}')[e.target.value];
              if (!t) return;
              const cm = {};
              columns.forEach(col => { if (t.byName[col]) cm[col] = t.byName[col]; });
              patch({ columnMapping: cm, transforms: t.transforms||{}, defaults: t.defaults||{} });
              toast.success('Template applied');
              e.target.value = '';
            }}>
            <option value="">Load template…</option>
            {Object.keys(JSON.parse(localStorage.getItem('rc_tpls_stock') || '{}')).map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          <button className="wz-btn" onClick={saveTpl}>Save as template</button>
        </div>
      </div>

      {/* Map summary */}
      <div className="row" id="mapSummary">
        {mapSummaryPills.map((p,i) => <span key={i} className={`wz-pill ${p.cls}`}>{p.t}</span>)}
      </div>

      {/* Map layout: left=mapping, right=schema panel */}
      <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) 340px', gap:14, alignItems:'start' }}
        className="map-layout-grid">
        <div className="stack" style={{ minWidth:0 }}>
          {/* Mapping list */}
          <div style={{ border:'1px solid var(--wz-line)', borderRadius:8, background:'var(--wz-surface)' }}>
            {/* Header row */}
            <div className="wz-map-row" style={{ background:'var(--wz-surface-2)', borderRadius:'8px 8px 0 0' }}>
              <div style={{ fontSize:11, fontWeight:600, color:'var(--wz-fg-3)', textTransform:'uppercase', letterSpacing:'.06em' }}>Source column</div>
              <div></div>
              <div style={{ fontSize:11, fontWeight:600, color:'var(--wz-fg-3)', textTransform:'uppercase', letterSpacing:'.06em' }}>RetailCLIQ target column</div>
              <div style={{ fontSize:11, fontWeight:600, color:'var(--wz-fg-3)', textTransform:'uppercase', letterSpacing:'.06em' }}>Transform</div>
            </div>
            <div style={{ maxHeight:380, overflowY:'auto' }} className="rc-scrollbar">
              {columns.map((col, i) => {
                const mapped_ = columnMapping[col];
                const def = COLUMN_DEFS.find(f => f.key === mapped_);
                const isReq = def?.req;
                const sample = rows.slice(0,3).map(r => r[i]||'').filter(Boolean).join(', ');
                const tr = transforms[col];
                const displaySample = tr && tr !== 'None' && rows[0]?.[i] ? applyTransform(rows[0][i], tr) : sample;
                return (
                  <div key={col} className="wz-map-row"
                    style={{ background: isReq ? '#fffef5' : 'transparent', borderBottom:'1px solid var(--wz-line)' }}>
                    <div className="src-col" style={{ display:'flex', flexDirection:'column', gap:2, minWidth:0 }}>
                      <b style={{ display:'block', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontFamily:'var(--wz-font-mono)', fontSize:12 }}>{col}</b>
                      <span style={{ fontFamily:'var(--wz-font-mono)', fontSize:11, color:'var(--wz-fg-3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{displaySample}</span>
                    </div>
                    <div style={{ textAlign:'center', color:'var(--wz-fg-3)' }}>→</div>
                    <select value={mapped_||''} onChange={e => setMap(col, e.target.value)}
                      className="wz-sel" style={{ height:32, fontSize:12, borderColor: isReq ? 'var(--wz-accent)' : 'var(--wz-line-strong)' }}
                      data-testid={`map-col-${i}`}>
                      <option value="">(skip / ignore)</option>
                      {COLUMN_DEFS.map(f => (
                        <option key={f.key} value={f.key}>
                          {f.key}{f.req?' *':''}{f.master?' → '+f.master:''}
                        </option>
                      ))}
                    </select>
                    {mapped_ ? (
                      <select value={tr||'None'} onChange={e => setTr(col, e.target.value)}
                        className="wz-sel" style={{ height:32, fontSize:11, color:'var(--wz-fg-3)' }}>
                        {TRANSFORMS.map(t => <option key={t}>{t}</option>)}
                      </select>
                    ) : <span />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Defaults card */}
          <div className="wz-card stack" id="defaultsCard">
            <div className="row" style={{ justifyContent:'space-between' }}>
              <div>
                <h3>Columns not in your file</h3>
                <p className="small muted">Target columns with no source column. Required ones must get a default rule; optional ones go in as blank.</p>
              </div>
              <div className="row">
                <button className="wz-btn sm" onClick={applyStdDefaults}>Apply standard defaults</button>
                <label className="check small" style={{ display:'flex', gap:6, alignItems:'center', cursor:'pointer', fontSize:12 }}>
                  <input type="checkbox" checked={showOpt} onChange={e => setShowOpt(e.target.checked)}
                    style={{ accentColor:'var(--wz-accent)' }} />
                  Show optional columns ({COLUMN_DEFS.filter(f => !f.req && !mapped.includes(f.key) && !defaults[f.key]).length})
                </label>
              </div>
            </div>

            {/* Required chips */}
            <div className="chips" style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {COLUMN_DEFS.filter(f => f.req && !mapped.includes(f.key) && !defaults[f.key]).map(f => (
                <span key={f.key} className="wz-chip" style={{ background:'var(--wz-err-soft)', color:'var(--wz-err)', borderColor:'var(--wz-err)' }}
                  data-req={f.key}>{f.key} *</span>
              ))}
            </div>

            {/* Default rows */}
            <div style={{ border:'1px solid var(--wz-line)', borderRadius:8, background:'var(--wz-surface)', overflow:'hidden' }}>
              <div className="wz-map-row" style={{ background:'var(--wz-surface-2)' }}>
                {['Target column','','Rule','Value / preview'].map(h => (
                  <div key={h} style={{ fontSize:11, fontWeight:600, color:'var(--wz-fg-3)', textTransform:'uppercase', letterSpacing:'.06em' }}>{h}</div>
                ))}
              </div>
              {(showOpt
                ? COLUMN_DEFS.filter(f => !mapped.includes(f.key))
                : COLUMN_DEFS.filter(f => (f.req || defaults[f.key]) && !mapped.includes(f.key))
              ).slice(0, 20).map(f => {
                const d = defaults[f.key] || {};
                const preview = d.mode === 'const' ? d.value : d.mode === 'blank' ? "''" : '';
                return (
                  <div key={f.key} className="wz-map-row" style={{ borderBottom:'1px solid var(--wz-line)' }}>
                    <div>
                      <b style={{ fontSize:12 }}>{f.key}</b>
                      {f.req && <span style={{ color:'var(--wz-err)', fontWeight:600 }}> *</span>}
                      <div style={{ fontSize:10, color:'var(--wz-fg-3)', fontFamily:'var(--wz-font-mono)' }}>{f.sql?.split(' ')[0] || 'text'}</div>
                    </div>
                    <div style={{ textAlign:'center', color:'var(--wz-fg-3)' }}>→</div>
                    <select value={d.mode||''} onChange={e => setDef(f.key, e.target.value)}
                      className="wz-sel" style={{ height:30, fontSize:11 }} data-testid={`def-mode-${f.key}`}>
                      <option value="">— choose rule —</option>
                      <option value="const">Fixed value</option>
                      <option value="blank">Leave blank ('')</option>
                      <option value="today">Today's date</option>
                      <option value="user">Logged-in user</option>
                      <option value="batch">Batch ID</option>
                    </select>
                    {d.mode === 'const' ? (
                      <input value={d.value||''} onChange={e => setDefVal(f.key, e.target.value)}
                        className="wz-inp" style={{ height:30, fontSize:11 }}
                        placeholder="value" data-testid={`def-val-${f.key}`} />
                    ) : d.mode ? (
                      <span className="mono small" style={{ color:'var(--wz-accent)' }}>→ {preview || d.mode}</span>
                    ) : <span className="wz-pill err">needs a rule</span>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Article name builder */}
          <div className="wz-card stack" id="artCard">
            <div className="row" style={{ justifyContent:'space-between' }}>
              <div>
                <h3>Article name builder</h3>
                <p className="small muted">Compose <span className="mono">ItemDescription</span> / <span className="mono">ArtName</span> from item properties. Tokens resolve from mapped or defaulted columns.</p>
              </div>
              <div className="chips" style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                {ART_PRESETS.map(p => (
                  <button key={p.label} className="wz-chip sm" style={{ padding:'2px 8px', fontSize:11 }}
                    onClick={() => setArtPat(p.pattern)}>{p.label}</button>
                ))}
              </div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, alignItems:'start' }}>
              <div className="stack">
                <div className="wz-field">
                  <label>Pattern</label>
                  <input className="wz-inp" value={artPat} onChange={e => setArtPat(e.target.value)}
                    placeholder="{Brand} {Category} {Style} {Color} {Size}" />
                </div>
                <div className="chips" style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                  {ART_TOKENS.map(t => (
                    <button key={t} className="wz-chip" style={{ fontSize:11, padding:'2px 8px' }}
                      onClick={() => setArtPat(p => p + `{${t}}`)}>
                      {`{${t}}`}
                    </button>
                  ))}
                </div>
                <div className="row">
                  <div className="wz-field" style={{ flex:1, minWidth:100 }}>
                    <label>Case</label>
                    <select className="wz-sel" value={artCase} onChange={e => setArtCase(e.target.value)}>
                      <option value="upper">UPPERCASE</option>
                      <option value="title">Title Case</option>
                      <option value="asis">As is</option>
                    </select>
                  </div>
                  <div className="wz-field" style={{ flex:1, minWidth:100 }}>
                    <label>Separator</label>
                    <select className="wz-sel" value={artSep} onChange={e => setArtSep(e.target.value)}>
                      <option value=" ">Space</option>
                      <option value=" - ">Hyphen ( - )</option>
                      <option value=" / ">Slash ( / )</option>
                      <option value=", ">Comma</option>
                      <option value="">None</option>
                    </select>
                  </div>
                  <div className="wz-field" style={{ flex:1, minWidth:130 }}>
                    <label>Write to</label>
                    <select className="wz-sel" value={artTarget} onChange={e => setArtTarget(e.target.value)}>
                      <option value="ItemDescription">ItemDescription (200)</option>
                      <option value="ArtName">ArtName (2000)</option>
                      <option value="both">Both</option>
                    </select>
                  </div>
                </div>
                <label className="check small" style={{ display:'flex', gap:8, cursor:'pointer', fontSize:12 }}>
                  <input type="checkbox" checked={artOverride} onChange={e => setArtOverride(e.target.checked)}
                    style={{ accentColor:'var(--wz-accent)' }} />
                  Replace the file's value even when the column is mapped
                </label>
                <div className="row">
                  <button className="wz-btn primary sm" onClick={applyArt}>Apply pattern</button>
                  <button className="wz-btn sm" onClick={() => {
                    const d = { ...defaults };
                    ['ItemDescription','ArtName'].forEach(k => { if (d[k]?.mode==='compose') delete d[k]; });
                    patch({ defaults: d });
                    toast.success('Pattern removed');
                  }}>Remove</button>
                  <span className="small muted">
                    {['ItemDescription','ArtName'].some(k => defaults[k]?.mode==='compose') ? 'Applied' : 'Not applied'}
                  </span>
                </div>
              </div>
              <div className="stack">
                <div className="eyebrow" style={{ fontSize:11, fontWeight:600, letterSpacing:'.08em', textTransform:'uppercase', color:'var(--wz-fg-3)' }}>Preview (first rows)</div>
                <div className="wz-log" style={{ height:'auto', maxHeight:180 }}>
                  {artPreview.map((line, i) => (
                    <div key={i}>{line} <span className="muted">· {line.length} chars</span></div>
                  ))}
                  {rows.length === 0 && <div className="muted">Load a file to preview</div>}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Schema panel (sticky aside) ─────────────────────── */}
        <aside className="wz-card wz-schema" id="schemaPanel">
          <div className="row" style={{ justifyContent:'space-between' }}>
            <div>
              <h3>Target schema</h3>
              <div className="small muted">{SCHEMA_GROUPS.length} objects · {COLUMN_DEFS.length} columns · 13 master tables</div>
            </div>
            <select className="wz-sel" style={{ width:'auto', height:28, fontSize:11, padding:'0 24px 0 6px' }}>
              <option value="catalog">Embedded catalog</option>
              <option value="live">Live: INFORMATION_SCHEMA</option>
            </select>
          </div>
          <input className="wz-inp" style={{ height:32, fontSize:12 }} value={schemaQ} onChange={e => setSchemaQ(e.target.value)}
            placeholder="Filter columns, tables, views…" />
          <div className="wz-schema-tree rc-scrollbar">
            {filteredCols ? (
              <div>
                {filteredCols.map(c => (
                  <div key={c.key} className="wz-st-col"
                    onClick={() => {
                      const firstUnmapped = columns.findIndex(col => !columnMapping[col]);
                      if (firstUnmapped >= 0) {
                        const cm = { ...columnMapping, [columns[firstUnmapped]]: c.key };
                        patch({ columnMapping: cm });
                        toast.success(`${columns[firstUnmapped]} → ${c.key}`);
                      }
                    }}>
                    <span style={{ width:7, height:7, borderRadius:'50%', background: Object.values(columnMapping).includes(c.key) ? 'var(--wz-accent)' : 'var(--wz-line-strong)', flexShrink:0 }} />
                    <span style={{ fontFamily:'var(--wz-font-mono)', flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis' }}>
                      {c.key}{c.req?' *':''}{c.master?` → ${c.master}`:''}
                    </span>
                    <span style={{ fontFamily:'var(--wz-font-mono)', fontSize:10, color:'var(--wz-fg-3)', whiteSpace:'nowrap' }}>{c.sql?.split(' ')[0]||''}</span>
                  </div>
                ))}
              </div>
            ) : SCHEMA_GROUPS.map(g => (
              <div key={g.name} style={{ borderBottom:'1px solid var(--wz-line)' }}>
                <div className="wz-st-head" onClick={() => setSchemaOpen(o => o===g.name?null:g.name)}>
                  <b style={{ flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontFamily:'var(--wz-font-mono)', fontSize:12 }}>{g.name}</b>
                  <span style={{ fontFamily:'var(--wz-font-mono)', fontSize:10, padding:'1px 6px', borderRadius:4, background:'var(--wz-surface)', color: g.kind==='staging'?'var(--wz-accent)':g.kind==='proc'?'var(--wz-warn)':'var(--wz-fg-2)', border:'1px solid var(--wz-line)', flexShrink:0 }}>{g.kind}</span>
                  <span style={{ color:'var(--wz-fg-3)', fontSize:12, transform: schemaOpen===g.name?'rotate(90deg)':'none', transition:'.15s' }}>›</span>
                </div>
                {schemaOpen === g.name && g.name === 'Stock_Import_Export' && (
                  <div>
                    {g.dep && <div style={{ padding:'6px 10px 6px 28px', fontSize:11, color:'var(--wz-fg-2)', borderBottom:'1px dashed var(--wz-line)' }}>{g.dep}</div>}
                    {COLUMN_DEFS.filter(c => !c.inferred).map(c => {
                      const isMapped = Object.values(columnMapping).includes(c.key);
                      return (
                        <div key={c.key} className="wz-st-col"
                          onClick={() => {
                            const firstUnmapped = columns.findIndex(col => !columnMapping[col]);
                            if (firstUnmapped >= 0) {
                              patch({ columnMapping: { ...columnMapping, [columns[firstUnmapped]]: c.key } });
                              toast.success(`Mapped to ${c.key}`);
                            }
                          }}>
                          <span style={{ width:7, height:7, borderRadius:'50%', background: isMapped ? 'var(--wz-accent)' : c.req ? 'var(--wz-err)' : 'var(--wz-line-strong)', flexShrink:0 }} />
                          <span style={{ fontFamily:'var(--wz-font-mono)', flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', fontWeight: isMapped ? 600 : 400, color: isMapped ? 'var(--wz-accent)' : 'inherit', fontSize:12 }}>
                            {c.key}{c.req?' *':''}
                          </span>
                          <span style={{ fontFamily:'var(--wz-font-mono)', fontSize:10, color:'var(--wz-fg-3)', whiteSpace:'nowrap' }}>{c.sql?.split(' ')[0]||''}</span>
                          {c.master && <span style={{ fontSize:10, color:'var(--wz-info)', whiteSpace:'nowrap', marginLeft:4 }}>→{c.master}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
                {schemaOpen === g.name && g.name !== 'Stock_Import_Export' && (
                  <div style={{ padding:'6px 10px 6px 28px', fontSize:11, color:'var(--wz-fg-2)' }}>{g.desc}</div>
                )}
              </div>
            ))}
          </div>
          <div className="small muted">Click a column to map it to the highlighted source column. Dependencies show the master table each FK points to.</div>
        </aside>
      </div>
    </div>
  );
}
