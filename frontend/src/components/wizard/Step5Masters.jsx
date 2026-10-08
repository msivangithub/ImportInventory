import { useState, useEffect } from 'react';
import { useWizard } from './WizardContext';
import api from '@/lib/api';
import { toast } from 'sonner';
import { autoMatch } from '@/lib/staging';
import { COL_MASTER_EXT, MASTER_TABLES_META } from '@/lib/wizard-constants';

// Extended master map that covers all 13 masters
const COL_MASTER_KEYS = Object.keys(COL_MASTER_EXT);

function buildMasterMap(columns, rows, columnMapping, apiMasters, dbMode) {
  const result = {};
  COL_MASTER_KEYS.forEach(stagingCol => {
    const masterKey = COL_MASTER_EXT[stagingCol];
    const fileColEntry = Object.entries(columnMapping||{}).find(([,v]) => v === stagingCol);
    if (!fileColEntry) return;
    const colIdx = columns?.indexOf(fileColEntry[0]);
    if (colIdx == null || colIdx < 0) return;
    const items = apiMasters?.[masterKey] || [];
    const seen = {};
    (rows||[]).forEach(row => { const v=(row[colIdx]||'').trim(); if(v) seen[v]=(seen[v]||0)+1; });
    if (!Object.keys(seen).length) return;
    const colMap = {};
    Object.entries(seen).forEach(([val, count]) => {
      const m = autoMatch(val, items);
      const mode = m.mode === 'existing' ? 'existing'
        : dbMode === 'fresh' ? 'new'
        : 'unresolved';
      colMap[val] = { count, mode: m.mode==='existing'?'existing':mode, to: m.mode==='existing'?m.to:val, toId: m.toId, via: m.via };
    });
    result[stagingCol] = colMap;
  });
  return result;
}

export default function Step5Masters() {
  const { ws, patch } = useWizard();
  const [apiMasters, setApiMasters] = useState(ws.masters);
  const [masterMap,  setMasterMap]  = useState(ws.masterMapData?.masterMap || null);
  const [activeTab,  setActiveTab]  = useState(null);
  const [search,     setSearch]     = useState('');
  const [filterMode, setFilterMode] = useState('all');
  const [showPolicy, setShowPolicy] = useState(false);
  const [policies,   setPolicies]   = useState({});
  const [selAll,     setSelAll]     = useState(false);
  const [selSet,     setSelSet]     = useState(new Set());

  // Load masters
  useEffect(() => {
    if (ws.masters) { setApiMasters(ws.masters); return; }
    api.get('/masters').then(({ data }) => {
      const m = data.masters || data;
      patch({ masters: m });
      setApiMasters(m);
    }).catch(() => {});
  }, [ws.masters]); // eslint-disable-line

  // Build initial map
  useEffect(() => {
    if (!apiMasters || masterMap) return;
    const m = buildMasterMap(ws.columns, ws.rows, ws.columnMapping, apiMasters, ws.dbMode);
    setMasterMap(m);
    setActiveTab(Object.keys(m)[0] || null);
  }, [apiMasters]); // eslint-disable-line

  const setDecision = (stagingCol, val, mode, to, toId) =>
    setMasterMap(prev => ({ ...prev, [stagingCol]: { ...prev[stagingCol], [val]: { ...prev[stagingCol][val], mode, to, toId, via:'' } } }));

  const reMatchAll = () => {
    if (!apiMasters || !masterMap) return;
    setMasterMap(prev => {
      const u = {};
      Object.entries(prev).forEach(([col, vals]) => {
        const items = apiMasters[COL_MASTER_EXT[col]] || [];
        u[col] = {};
        Object.entries(vals).forEach(([val, v]) => {
          const m = autoMatch(val, items);
          u[col][val] = { ...v, mode:m.mode, to:m.to||val, toId:m.toId, via:m.via };
        });
      });
      return u;
    });
    toast.success('Re-match complete');
  };

  const keepCreate = () => {
    setMasterMap(prev => {
      const u = {};
      Object.entries(prev).forEach(([col, vals]) => {
        u[col] = {};
        Object.entries(vals).forEach(([val, v]) => {
          u[col][val] = v.mode==='existing' ? v : { ...v, mode:'new', to:val, toId:null, via:'' };
        });
      });
      return u;
    });
    toast.success('Kept matched — unresolved set to Create new');
  };

  // Persist to context when map changes
  useEffect(() => {
    if (!masterMap) return;
    const resolution = {};
    Object.entries(masterMap).forEach(([col, vals]) => {
      resolution[col] = {};
      Object.entries(vals).forEach(([fileVal, v]) => {
        if (v.mode==='existing' && v.to!==fileVal) resolution[col][fileVal] = v.to;
        else if (v.mode==='skip') resolution[col][fileVal] = '';
      });
    });
    patch({ masterMapData: { resolution, masterMap, initialized:true } });
  }, [masterMap]); // eslint-disable-line

  // Nav
  const allEntries = masterMap ? Object.values(masterMap).flatMap(m => Object.values(m)) : [];
  const unresolved = allEntries.filter(d => !['existing','new','skip'].includes(d.mode)).length;

  useEffect(() => {
    patch({ nav: {
      backEnabled: true,
      nextEnabled: true,
      nextLabel: 'Continue →',
      statusText: masterMap
        ? unresolved > 0 ? `${unresolved} master values unresolved` : 'All master values resolved'
        : 'Loading master data…',
    }});
  }, [unresolved, !!masterMap]); // eslint-disable-line

  if (!masterMap) return (
    <div className="wz-card" style={{ padding:40, textAlign:'center', color:'var(--wz-fg-3)' }}>Loading master data…</div>
  );

  const totalDistinct = allEntries.length;
  const matchedCount  = allEntries.filter(d => d.mode==='existing').length;
  const createCount   = allEntries.filter(d => d.mode==='new').length;
  const skipCount     = allEntries.filter(d => d.mode==='skip').length;

  const activeCols = Object.keys(masterMap);
  const activeItems = activeTab ? (masterMap[activeTab]||{}) : {};
  const apiItems   = activeTab ? (apiMasters?.[COL_MASTER_EXT[activeTab]]||[]) : [];
  const meta       = activeTab ? MASTER_TABLES_META[COL_MASTER_EXT[activeTab]] : null;

  const tabCounts = (col) => {
    const vals = Object.values(masterMap[col]||{});
    return { total:vals.length, unres:vals.filter(v=>!['existing','new','skip'].includes(v.mode)).length, newC:vals.filter(v=>v.mode==='new').length };
  };

  const filtered = Object.entries(activeItems).filter(([val, v]) => {
    if (filterMode!=='all' && v.mode!==filterMode) return false;
    if (search && !val.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const modeCls = { existing:'mm-row e', new:'mm-row n', skip:'mm-row s', unresolved:'mm-row u' };

  // Item identity section (items identified by code)
  const { columns: cols, rows: rowData, columnMapping: cm } = ws;
  const itemCodes = (() => {
    const codeEntry = Object.entries(cm||{}).find(([,v]) => v==='ItemCode');
    const oemEntry  = Object.entries(cm||{}).find(([,v]) => v==='OEMCode');
    if (!codeEntry && !oemEntry) return null;
    const codeIdx = codeEntry ? cols?.indexOf(codeEntry[0]) : -1;
    const oemIdx  = oemEntry  ? cols?.indexOf(oemEntry[0])  : -1;
    const codes = new Set();
    (rowData||[]).forEach(r => {
      if (codeIdx>=0 && r[codeIdx]) codes.add(r[codeIdx]);
      else if (oemIdx>=0 && r[oemIdx]) codes.add(r[oemIdx]);
    });
    return codes.size;
  })();

  return (
    <div className="stack" data-testid="step-masters">
      {/* Panel head */}
      <div className="panel-head" style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, flexWrap:'wrap', marginBottom:14 }}>
        <div>
          <h2 style={{ fontSize:18, fontWeight:600 }}>Master mapping</h2>
          <p className="muted small">Every distinct value in a master column must point to an existing RetailCLIQ master, be created new, or be skipped. Use the bulk actions; row-by-row is the exception.</p>
        </div>
        <div className="row">
          <button className="wz-btn primary" onClick={keepCreate}>Keep matched, create the rest</button>
          <button className="wz-btn" onClick={reMatchAll}>Re-run auto match</button>
          <button className="wz-btn" onClick={() => setShowPolicy(p => !p)}>Policies per master</button>
        </div>
      </div>

      {/* Item identity card */}
      {itemCodes != null && (
        <div className="wz-card" id="itemIdentity">
          <h3 style={{ marginBottom:6 }}>Items – identified by code, not matched as a master</h3>
          <p className="small muted" style={{ marginBottom:8 }}>Lookup Item codes, ItemCode/OEMCode. New items are inserted by proc_StockImportwithSupplier with their attributes resolved from the masters below.</p>
          <div className="row" style={{ gap:8 }}>
            <span className="wz-pill info">{itemCodes} distinct item codes</span>
            <span className="wz-pill n">insert when new · update when existing</span>
          </div>
        </div>
      )}

      {/* Summary tiles */}
      {totalDistinct > 0 && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))', gap:10 }}>
          {[
            { cls:'n',    v:`${totalDistinct} Distinct values across ${activeCols.length} masters`, l:'Distinct values' },
            { cls:'ok',   v:matchedCount,  l:'Matched to existing' },
            { cls:'info', v:createCount,   l:'Will be created'     },
            { cls:'warn', v:skipCount,     l:'Rows skipped'        },
            { cls:unresolved?'err':'n', v:unresolved, l:'Unresolved' },
          ].map(t => (
            <div key={t.l} className={`wz-tile ${t.cls}`}>
              <div className="v" style={{ fontSize: t.l==='Distinct values'?14:24, lineHeight:1.2 }}>{t.v}</div>
              <div className="l">{t.l}</div>
            </div>
          ))}
        </div>
      )}

      {/* Policy card */}
      {showPolicy && (
        <div className="wz-card stack" id="policyCard">
          <div className="row" style={{ justifyContent:'space-between' }}>
            <div>
              <h3>Policy per master</h3>
              <p className="small muted">One decision per master table, applied to every unresolved value. Matched values are kept as Existing.</p>
            </div>
            <div className="row">
              <button className="wz-btn sm" onClick={() => {
                const p = {};
                activeCols.forEach(c => { p[c] = { mode:'new', to:'' }; });
                setPolicies(p);
              }}>All → Create new</button>
              <button className="wz-btn sm primary" onClick={() => {
                setMasterMap(prev => {
                  const u = { ...prev };
                  activeCols.forEach(col => {
                    const pol = policies[col];
                    if (!pol || pol.mode==='keep') return;
                    u[col] = { ...u[col] };
                    Object.entries(u[col]).forEach(([val, v]) => {
                      if (v.mode!=='unresolved') return;
                      if (pol.mode==='new') u[col][val] = { ...v, mode:'new', to:val, via:'policy' };
                      else if (pol.mode==='skip') u[col][val] = { ...v, mode:'skip', to:'', via:'policy' };
                      else if (pol.mode==='one') u[col][val] = { ...v, mode:'existing', to:pol.to, via:'policy' };
                    });
                  });
                  return u;
                });
                toast.success('Policies applied');
              }}>Apply policies</button>
            </div>
          </div>
          <div className="wz-tbl-wrap">
            <table>
              <thead><tr>
                <th>Master</th><th>Table</th><th>Distinct</th><th>Matched</th><th>Unresolved</th>
                <th>Policy for unresolved</th><th>Default value</th>
              </tr></thead>
              <tbody>
                {activeCols.map(col => {
                  const { total, unres } = tabCounts(col);
                  const m_ = MASTER_TABLES_META[COL_MASTER_EXT[col]];
                  const pol = policies[col] || { mode:'keep', to:'' };
                  return (
                    <tr key={col}>
                      <td><b>{m_?.label||col}</b></td>
                      <td style={{ fontFamily:'var(--wz-font-mono)', fontSize:11 }}>{COL_MASTER_EXT[col]}</td>
                      <td className="num">{total}</td>
                      <td className="num">{total - unres}</td>
                      <td className="num">{unres > 0 ? <span className="wz-pill err">{unres}</span> : '0'}</td>
                      <td>
                        <select value={pol.mode} onChange={e => setPolicies(p => ({ ...p, [col]: { ...pol, mode:e.target.value } }))}
                          className="wz-sel" style={{ height:28, fontSize:11 }}>
                          <option value="keep">Keep existing / leave unresolved</option>
                          <option value="new">Create new</option>
                          <option value="skip">Skip rows</option>
                          <option value="one">Map all to one existing</option>
                        </select>
                      </td>
                      <td>
                        {pol.mode === 'one' && (
                          <select value={pol.to||''} onChange={e => setPolicies(p => ({ ...p, [col]: { ...pol, to:e.target.value } }))}
                            className="wz-sel" style={{ height:28, fontSize:11 }}>
                            <option value="">— choose —</option>
                            {(apiMasters?.[COL_MASTER_EXT[col]]||[]).map(it => <option key={it.id} value={it.name}>{it.name} [{it.id}]</option>)}
                          </select>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Master tabs + list */}
      <div className="wz-card">
        {/* Tabs */}
        <div className="wz-m-tabs" id="mTabs">
          {activeCols.map(col => {
            const { total, unres, newC } = tabCounts(col);
            const m_ = MASTER_TABLES_META[COL_MASTER_EXT[col]];
            return (
              <button key={col} className={`wz-m-tab ${col===activeTab?'on':''}`}
                onClick={() => { setActiveTab(col); setSearch(''); setFilterMode('all'); setSelSet(new Set()); }}
                data-testid={`master-tab-${col}`}>
                {m_?.label||col}
                <span className="cnt">{total}</span>
                {unres > 0 && <span className="wz-pill err" style={{ fontSize:10, padding:'0 5px' }}>{unres}</span>}
                {newC > 0 && unres===0 && <span className="wz-pill info" style={{ fontSize:10, padding:'0 5px' }}>+{newC}</span>}
              </button>
            );
          })}
        </div>

        {/* Tools */}
        <div className="stack" id="mmTools">
          <div className="row" style={{ justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
            <div className="row">
              <input className="wz-inp" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search values…" style={{ maxWidth:200, height:32, fontSize:12 }} />
              <div className="chips" id="mmFilter" style={{ display:'flex', gap:4 }}>
                {['all','unresolved','existing','new','skip'].map(f => (
                  <button key={f} className={`wz-chip ${filterMode===f?'on':''}`} type="button"
                    onClick={() => setFilterMode(f)} style={{ fontSize:11, padding:'3px 9px' }}>
                    {f.charAt(0).toUpperCase()+f.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="row">
              <button className="wz-btn sm" onClick={() => {
                if (!activeTab) return;
                const items = apiMasters?.[COL_MASTER_EXT[activeTab]] || [];
                setMasterMap(prev => {
                  const u = { ...prev, [activeTab]: { ...prev[activeTab] } };
                  Object.entries(u[activeTab]).forEach(([val, v]) => {
                    if (v.mode!=='unresolved') return;
                    const m_ = autoMatch(val, items);
                    if (m_.mode==='existing') u[activeTab][val] = { ...v, mode:'existing', to:m_.to, toId:m_.toId, via:`fuzzy ${m_.via}` };
                  });
                  return u;
                });
                toast.success('Fuzzy match applied');
              }}>Fuzzy match</button>
              <button className="wz-btn sm" onClick={() => {
                if (!activeTab) return;
                setMasterMap(prev => { const u={...prev,[activeTab]:{...prev[activeTab]}}; Object.entries(u[activeTab]).forEach(([val,v])=>{ if(v.mode==='unresolved'){u[activeTab][val]={...v,mode:'new',to:val,via:''};} }); return u; });
                toast.success('Unresolved → Create new');
              }}>Unresolved → Create new</button>
              <button className="wz-btn sm" onClick={() => {
                if (!activeTab) return;
                setMasterMap(prev => { const u={...prev,[activeTab]:{...prev[activeTab]}}; Object.entries(u[activeTab]).forEach(([val,v])=>{ if(v.mode==='unresolved'){u[activeTab][val]={...v,mode:'skip',to:'',via:''};} }); return u; });
                toast.success('Unresolved → Skip');
              }}>Unresolved → Skip</button>
            </div>
          </div>

          {/* Bulk action bar */}
          <div className="wz-bulk-bar">
            <label className="check small" style={{ display:'flex', gap:6, alignItems:'center', cursor:'pointer', fontSize:12 }}>
              <input type="checkbox" checked={selAll} onChange={e => {
                setSelAll(e.target.checked);
                if (e.target.checked) setSelSet(new Set(filtered.map(([v]) => v)));
                else setSelSet(new Set());
              }} style={{ accentColor:'var(--wz-accent)' }} />
              Select all shown
            </label>
            <span className="small muted">{selSet.size} selected</span>
            <span className="small">With selected →</span>
            <select className="wz-sel" style={{ maxWidth:220, height:28, fontSize:11 }} id="bulkExisting" defaultValue="">
              <option value="">— existing value —</option>
              {apiItems.map(it => <option key={it.id} value={it.name}>{it.name} [{it.id}]</option>)}
            </select>
            <button className="wz-btn sm" onClick={() => {
              const target = document.getElementById('bulkExisting')?.value;
              if (!target) return;
              selSet.forEach(val => setDecision(activeTab, val, 'existing', target, apiItems.find(i=>i.name===target)?.id||null));
              setSelSet(new Set()); setSelAll(false);
            }}>Map to this existing</button>
            <button className="wz-btn sm" onClick={() => { selSet.forEach(val => setDecision(activeTab,val,'new',val,null)); setSelSet(new Set()); setSelAll(false); }}>Create new</button>
            <button className="wz-btn sm" onClick={() => { selSet.forEach(val => setDecision(activeTab,val,'skip','',null)); setSelSet(new Set()); setSelAll(false); }}>Skip</button>
            <span className="small muted">·</span>
            <button className="wz-btn sm" onClick={() => {
              const target = document.getElementById('bulkExisting')?.value;
              if (!target) { toast.warning('Choose an existing value first'); return; }
              let n=0;
              Object.entries(activeItems).forEach(([val,v]) => { if(v.mode==='unresolved'){setDecision(activeTab,val,'existing',target,apiItems.find(i=>i.name===target)?.id||null);n++;} });
              toast.success(`${n} unresolved mapped to ${target}`);
            }}>All unresolved → this existing</button>
          </div>
        </div>

        {/* Master value list */}
        <div id="mmList">
          {activeTab && meta && (
            <div style={{ padding:'8px 12px', background:'var(--wz-surface-2)', fontSize:11, color:'var(--wz-fg-3)', borderBottom:'1px solid var(--wz-line)' }}>
              {meta.label} — key <span className="mono">{meta.id}</span>, display <span className="mono">{meta.name}</span>{meta.inferred?' — table name to verify':''}
            </div>
          )}
          {/* Column header */}
          <div className="wz-mm-row" style={{ background:'var(--wz-surface-2)' }}>
            <div><input type="checkbox" style={{ accentColor:'var(--wz-accent)' }} /></div>
            <div style={{ fontSize:11, fontWeight:600, color:'var(--wz-fg-3)', textTransform:'uppercase' }}>Source value</div>
            <div style={{ fontSize:11, fontWeight:600, color:'var(--wz-fg-3)', textTransform:'uppercase' }}>{meta ? `${meta.label} (${meta.name} [${meta.id}])` : 'Target'}</div>
            <div style={{ fontSize:11, fontWeight:600, color:'var(--wz-fg-3)', textTransform:'uppercase' }}>Action</div>
          </div>
          <div style={{ maxHeight:320, overflowY:'auto' }} className="rc-scrollbar">
            {filtered.length === 0 ? (
              <div style={{ padding:'24px', textAlign:'center', fontSize:12, color:'var(--wz-fg-3)' }}>No values match this filter</div>
            ) : filtered.map(([val, v]) => (
              <div key={val} className={`wz-mm-row ${v.mode==='existing'?'e':v.mode==='new'?'n':v.mode==='skip'?'s':v.mode==='unresolved'?'u':''}`}
                data-testid={`master-val-${activeTab}-${val}`}>
                <input type="checkbox" checked={selSet.has(val)}
                  onChange={e => { const s=new Set(selSet); if(e.target.checked) s.add(val); else s.delete(val); setSelSet(s); }}
                  style={{ width:16, height:16, accentColor:'var(--wz-accent)', margin:0 }} />
                <div style={{ minWidth:0 }}>
                  <div style={{ fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{val}</div>
                  <div style={{ fontSize:10, color:'var(--wz-fg-3)' }}>{v.count} row{v.count!==1?'s':''}
                    {v.via&&<span style={{ color:'var(--wz-fg-3)', marginLeft:4 }}>· {v.via}</span>}
                  </div>
                </div>
                <div style={{ minWidth:0 }}>
                  {v.mode==='existing' ? (
                    <select value={v.to||''} onChange={e => { const item=apiItems.find(it=>it.name===e.target.value); setDecision(activeTab,val,'existing',e.target.value,item?.id||null); }}
                      className="wz-sel" style={{ height:28, fontSize:11, borderColor:'var(--wz-ok)' }}>
                      {apiItems.map(it => <option key={it.id} value={it.name}>{it.name} [{it.id}]</option>)}
                    </select>
                  ) : v.mode==='new' ? (
                    <span className="small" style={{ color:'var(--wz-info)' }}>+Create "{val}"</span>
                  ) : v.mode==='skip' ? (
                    <span className="small" style={{ color:'var(--wz-warn)' }}>{v.count} rows will be skipped</span>
                  ) : (
                    <span className="wz-pill err">Unresolved</span>
                  )}
                </div>
                <div style={{ display:'flex', gap:4 }}>
                  <button className={`wz-btn sm ${v.mode==='existing'?'primary':''}`} style={{ padding:'3px 8px', fontSize:11 }}
                    onClick={() => { const m=autoMatch(val,apiItems); setDecision(activeTab,val,'existing',m.to||(apiItems[0]?.name||val),m.toId); }}>Existing</button>
                  <button className={`wz-btn sm ${v.mode==='new'?'primary':''}`} style={{ padding:'3px 8px', fontSize:11 }}
                    onClick={() => setDecision(activeTab,val,'new',val,null)}>Create new</button>
                  <button className={`wz-btn sm ${v.mode==='skip'?'primary':''}`} style={{ padding:'3px 8px', fontSize:11 }}
                    onClick={() => setDecision(activeTab,val,'skip','',null)}>Skip rows</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <label className="check small" style={{ display:'flex', gap:8, alignItems:'center', cursor:'pointer', fontSize:12, margin:'8px 12px 4px' }}>
          <input type="checkbox" defaultChecked style={{ accentColor:'var(--wz-accent)' }} />
          Remember these matches as aliases for future imports (e.g. Pcs → PCS, GROCERY → GROCERY [CAT001])
        </label>
      </div>
    </div>
  );
}
