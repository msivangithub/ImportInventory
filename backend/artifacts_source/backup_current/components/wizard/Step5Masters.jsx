import { useState, useEffect } from 'react';
import { useWizard } from './WizardContext';
import api from '@/lib/api';
import { toast } from 'sonner';
import { COL_MASTER, MASTER_META, autoMatch } from '@/lib/staging';

const CARD = { background:'#fff', border:'1px solid #d3dae1', borderRadius:10, boxShadow:'0 1px 3px rgba(21,32,43,.06)', padding:'18px 20px' };
const BTN_PRIMARY = { background:'#0f6e74', color:'#fff', border:'none', borderRadius:7, padding:'9px 20px', fontSize:13, fontWeight:600, cursor:'pointer' };
const BTN_OUTLINE = { background:'#fff', color:'#4b5a68', border:'1px solid #aab5c0', borderRadius:7, padding:'9px 16px', fontSize:13, fontWeight:500, cursor:'pointer' };
const SEL_BASE = { height:28, fontSize:11, border:'1px solid #d3dae1', borderRadius:5, background:'#fff', fontFamily:'inherit', padding:'0 6px' };

const MODE_STYLE = {
  existing:   { background:'#dff3e5', color:'#1f7a3c', borderColor:'#1f7a3c44' },
  new:        { background:'#e0eafb', color:'#2457a8', borderColor:'#2457a844' },
  skip:       { background:'#fbeed3', color:'#a4620a', borderColor:'#a4620a44' },
  unresolved: { background:'#fbe1e1', color:'#b42323', borderColor:'#b4232344' },
};

function buildInitialMap(columns, allRows, columnMapping, apiMasters) {
  const result = {};
  Object.entries(COL_MASTER).forEach(([stagingCol, masterKey]) => {
    const fileColEntry = Object.entries(columnMapping || {}).find(([, v]) => v === stagingCol);
    if (!fileColEntry) return;
    const colIdx = columns?.indexOf(fileColEntry[0]);
    if (colIdx == null || colIdx < 0) return;
    const items = apiMasters?.[masterKey] || [];
    const seen = {};
    (allRows || []).forEach(row => { const v = (row[colIdx] || '').trim(); if (v) seen[v] = (seen[v] || 0) + 1; });
    if (!Object.keys(seen).length) return;
    const colMap = {};
    Object.entries(seen).forEach(([val, count]) => {
      const m = autoMatch(val, items);
      colMap[val] = { count, mode: m.mode, to: m.to, toId: m.toId, via: m.via };
    });
    result[stagingCol] = colMap;
  });
  return result;
}

export default function Step5Masters() {
  const { ws, patch } = useWizard();
  const [apiMasters, setApiMasters] = useState(ws.masters);
  const [masterMap, setMasterMap] = useState(ws.masterMapData?.masterMap || null);
  const [activeTab, setActiveTab] = useState(null);
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState('all');

  useEffect(() => {
    if (ws.masters) { setApiMasters(ws.masters); return; }
    api.get('/masters').then(({ data }) => setApiMasters(data.masters || data)).catch(() => {});
  }, [ws.masters]);

  useEffect(() => {
    if (!apiMasters || masterMap) return;
    const m = buildInitialMap(ws.columns, ws.rows, ws.columnMapping, apiMasters);
    setMasterMap(m);
    setActiveTab(Object.keys(m)[0] || null);
  }, [apiMasters, ws.columns, ws.rows, ws.columnMapping, masterMap]);

  const setDecision = (stagingCol, fileVal, mode, to, toId) =>
    setMasterMap(prev => ({ ...prev, [stagingCol]: { ...prev[stagingCol], [fileVal]: { ...prev[stagingCol][fileVal], mode, to, toId } } }));

  const reMatchAll = () => {
    if (!apiMasters || !masterMap) return;
    setMasterMap(prev => {
      const u = {};
      Object.entries(prev).forEach(([col, vals]) => {
        const items = apiMasters[COL_MASTER[col]] || [];
        u[col] = {};
        Object.entries(vals).forEach(([val, v]) => { const m = autoMatch(val, items); u[col][val] = { ...v, mode:m.mode, to:m.to, toId:m.toId, via:m.via }; });
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
        Object.entries(vals).forEach(([val, v]) => { u[col][val] = v.mode === 'existing' ? v : { ...v, mode:'new', to:val, toId:null }; });
      });
      return u;
    });
    toast.success('Kept matched — unresolved set to Create new');
  };

  const handleNext = () => {
    const resolution = {};
    Object.entries(masterMap || {}).forEach(([col, vals]) => {
      resolution[col] = {};
      Object.entries(vals).forEach(([fileVal, v]) => {
        if (v.mode === 'existing' && v.to !== fileVal) resolution[col][fileVal] = v.to;
        else if (v.mode === 'skip') resolution[col][fileVal] = '';
      });
    });
    patch({ masterMapData: { resolution, masterMap, initialized: true }, step: ws.step + 1, maxStep: Math.max(ws.maxStep, ws.step + 1) });
  };

  if (!masterMap) {
    return (
      <div style={{...CARD, textAlign:'center', padding:40}}>
        <p style={{color:'#7b8894',fontSize:13}}>Loading master data…</p>
      </div>
    );
  }

  const allEntries = Object.values(masterMap).flatMap(m => Object.values(m));
  const totalDistinct = allEntries.length;
  const matchedCount  = allEntries.filter(d => d.mode === 'existing').length;
  const createCount   = allEntries.filter(d => d.mode === 'new').length;
  const skipCount     = allEntries.filter(d => d.mode === 'skip').length;
  const unresolved    = allEntries.filter(d => !['existing','new','skip'].includes(d.mode)).length;

  const activeCols = Object.keys(masterMap);
  const activeItems = activeTab ? (masterMap[activeTab] || {}) : {};
  const apiItems   = activeTab ? (apiMasters?.[COL_MASTER[activeTab]] || []) : [];

  const filtered = Object.entries(activeItems).filter(([val, v]) => {
    if (filterMode !== 'all' && v.mode !== filterMode) return false;
    if (search && !val.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const tabCounts = (col) => {
    const vals = Object.values(masterMap[col] || {});
    return { total: vals.length, unres: vals.filter(v => !['existing','new','skip'].includes(v.mode)).length };
  };

  return (
    <div style={{display:'flex',flexDirection:'column',gap:16}} data-testid="step-masters">
      <div style={CARD}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:10,marginBottom:14}}>
          <div>
            <h2 style={{fontSize:16,fontWeight:600,margin:'0 0 3px'}}>Master mapping</h2>
            <p style={{fontSize:12,color:'#7b8894',margin:0}}>Match each distinct value to an existing master, create new, or skip rows</p>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={reMatchAll} style={BTN_OUTLINE}>↺ Re-match all</button>
            <button onClick={keepCreate} style={BTN_OUTLINE}>✓ Keep matched, create rest</button>
          </div>
        </div>

        {/* Summary tiles */}
        {totalDistinct > 0 && (
          <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:8,marginBottom:14}}>
            {[
              [totalDistinct,'Distinct','#15202b','#f3f5f7'],
              [matchedCount,'Matched','#1f7a3c','#dff3e5'],
              [createCount,'Create','#2457a8','#e0eafb'],
              [skipCount,'Skip','#a4620a','#fbeed3'],
              [unresolved,'Unresolved',unresolved?'#b42323':'#7b8894',unresolved?'#fbe1e1':'#f3f5f7'],
            ].map(([v,l,color,bg]) => (
              <div key={l} style={{border:'1px solid',borderColor:bg,background:bg,borderRadius:8,padding:'8px 12px',textAlign:'center'}}>
                <div style={{fontSize:18,fontWeight:700,color}}>{v}</div>
                <div style={{fontSize:10,color:'#7b8894',marginTop:1}}>{l}</div>
              </div>
            ))}
          </div>
        )}

        {activeCols.length === 0 ? (
          <div style={{background:'#f3f5f7',border:'1px dashed #d3dae1',borderRadius:8,padding:24,textAlign:'center',fontSize:12,color:'#7b8894'}}>
            No master columns mapped — continuing will skip this step
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div style={{display:'flex',gap:6,flexWrap:'wrap',borderBottom:'1px solid #d3dae1',paddingBottom:8,marginBottom:12}}>
              {activeCols.map(col => {
                const { total, unres } = tabCounts(col);
                const meta = MASTER_META[COL_MASTER[col]];
                return (
                  <button key={col} onClick={() => { setActiveTab(col); setSearch(''); setFilterMode('all'); }}
                    style={{
                      padding:'5px 10px',borderRadius:5,border:`1px solid ${activeTab===col?'#0f6e74':'#d3dae1'}`,
                      background:activeTab===col?'#dcf1f1':'#f3f5f7',cursor:'pointer',fontSize:11,fontWeight:500,
                      color:activeTab===col?'#0f6e74':'#4b5a68',display:'flex',alignItems:'center',gap:5,
                    }}
                    data-testid={`master-tab-${col}`}>
                    {meta?.label || col}
                    <span style={{background:'#fff',borderRadius:999,padding:'1px 6px',fontSize:10}}>{total}</span>
                    {unres > 0 && <span style={{background:'#fbe1e1',color:'#b42323',borderRadius:999,padding:'1px 5px',fontSize:10}}>{unres}!</span>}
                  </button>
                );
              })}
            </div>

            {activeTab && (
              <div>
                {/* Toolbar */}
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8,flexWrap:'wrap'}}>
                  <input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder={`Search values…`}
                    style={{...SEL_BASE,width:180,height:30,padding:'0 8px'}} />
                  <div style={{display:'flex',gap:4}}>
                    {['all','existing','new','skip'].map(f => (
                      <button key={f} onClick={() => setFilterMode(f)}
                        style={{padding:'2px 8px',borderRadius:4,border:'1px solid',fontSize:10,cursor:'pointer',
                          borderColor:filterMode===f?'#0f6e74':'#d3dae1',background:filterMode===f?'#0f6e74':'#fff',
                          color:filterMode===f?'#fff':'#4b5a68'}}>
                        {f.charAt(0).toUpperCase()+f.slice(1)}
                      </button>
                    ))}
                  </div>
                  <div style={{display:'flex',gap:4,marginLeft:'auto'}}>
                    <button onClick={() => { setMasterMap(prev => { const u={...prev,[activeTab]:{}}; Object.entries(prev[activeTab]).forEach(([v,d])=>{u[activeTab][v]={...d,mode:'new',to:v,toId:null}}); return u; }); }}
                      style={{...SEL_BASE,height:26,padding:'0 8px',cursor:'pointer'}}>All → Create</button>
                  </div>
                </div>

                {/* Value list */}
                <div style={{border:'1px solid #d3dae1',borderRadius:8,overflow:'hidden'}}>
                  <div style={{maxHeight:280,overflowY:'auto'}} className="rc-scrollbar">
                    {filtered.length === 0 ? (
                      <div style={{padding:'24px',textAlign:'center',fontSize:12,color:'#7b8894'}}>No values match this filter</div>
                    ) : filtered.map(([val, v]) => (
                      <div key={val}
                        style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',borderBottom:'1px solid #f3f5f7',borderLeft:`3px solid ${MODE_STYLE[v.mode]?.color||'#d3dae1'}`}}
                        data-testid={`master-val-${activeTab}-${val}`}>
                        <div style={{flex:1,minWidth:0}}>
                          <span style={{fontSize:12,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',display:'block'}}>{val}</span>
                          <span style={{fontSize:10,color:'#7b8894'}}>{v.count} row{v.count!==1?'s':''}
                            {v.via&&<span style={{color:'#7b8894',marginLeft:4}}>· via {v.via}</span>}
                          </span>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
                          <select value={v.mode} onChange={e => {
                            const mode = e.target.value;
                            if (mode==='new') setDecision(activeTab,val,'new',val,null);
                            else if (mode==='skip') setDecision(activeTab,val,'skip','',null);
                            else { const m=autoMatch(val,apiItems); setDecision(activeTab,val,'existing',m.to||(apiItems[0]?.name||val),m.toId); }
                          }} style={{...SEL_BASE,width:120,borderColor:MODE_STYLE[v.mode]?.borderColor||'#d3dae1',background:MODE_STYLE[v.mode]?.background||'#fff'}}>
                            <option value="existing">Use existing</option>
                            <option value="new">Create new</option>
                            <option value="skip">Skip rows</option>
                          </select>
                          {v.mode==='existing' && (
                            <select value={v.to||''} onChange={e => { const item=apiItems.find(it=>it.name===e.target.value); setDecision(activeTab,val,'existing',e.target.value,item?.id||null); }}
                              style={{...SEL_BASE,width:170,borderColor:'#0f6e74'}}>
                              {apiItems.map(it=><option key={it.id} value={it.name}>{it.name} [{it.id}]</option>)}
                            </select>
                          )}
                          {v.mode==='new'&&<span style={{fontSize:10,padding:'2px 8px',borderRadius:999,background:'#e0eafb',color:'#2457a8',whiteSpace:'nowrap'}}>+Create</span>}
                          {v.mode==='skip'&&<span style={{fontSize:10,padding:'2px 8px',borderRadius:999,background:'#fbeed3',color:'#a4620a',whiteSpace:'nowrap'}}>{v.count} skipped</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div style={{display:'flex',justifyContent:'space-between',paddingTop:4}}>
        <button onClick={() => patch({ step: ws.step - 1 })} style={BTN_OUTLINE}>← Back</button>
        <button onClick={handleNext} style={BTN_PRIMARY} data-testid="wizard-masters-next">Continue → Validate</button>
      </div>
    </div>
  );
}
