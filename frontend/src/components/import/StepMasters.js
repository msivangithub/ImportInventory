import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { GitMerge, ChevronRight, ChevronLeft, RefreshCw, CheckCircle2 } from 'lucide-react';
import { COL_MASTER, MASTER_META, autoMatch } from '@/lib/staging';

// Chip decision colors
const MODE_CLS = {
  existing:   'bg-emerald-50 text-emerald-700 border-emerald-300',
  new:        'bg-blue-50 text-blue-700 border-blue-200',
  skip:       'bg-amber-50 text-amber-700 border-amber-300',
  unresolved: 'bg-rose-50 text-rose-600 border-rose-200',
};

// Build the master value map from the mapped rows
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

export default function StepMasters({ ws, patch }) {
  const [apiMasters, setApiMasters] = useState(null);
  const [masterMap, setMasterMap] = useState(ws.masterMapData?.masterMap || null);
  const [activeTab, setActiveTab] = useState(null);
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState('all');

  useEffect(() => {
    api.get('/masters').then(({ data }) => setApiMasters(data)).catch(() => {});
  }, []);

  // Build initial map once masters are loaded
  useEffect(() => {
    if (!apiMasters || masterMap) return;
    const m = buildInitialMap(ws.uploadData?.columns, ws.uploadData?.allRows, ws.uploadData?.columnMapping, apiMasters);
    setMasterMap(m);
    setActiveTab(Object.keys(m)[0] || null);
  }, [apiMasters, ws.uploadData, masterMap]);

  const setDecision = (stagingCol, fileVal, mode, to, toId) => {
    setMasterMap(prev => ({
      ...prev,
      [stagingCol]: { ...prev[stagingCol], [fileVal]: { ...prev[stagingCol][fileVal], mode, to, toId } }
    }));
  };

  const reMatchAll = () => {
    if (!apiMasters || !masterMap) return;
    setMasterMap(prev => {
      const updated = {};
      Object.entries(prev).forEach(([col, vals]) => {
        const items = apiMasters[COL_MASTER[col]] || [];
        updated[col] = {};
        Object.entries(vals).forEach(([val, v]) => {
          const m = autoMatch(val, items);
          updated[col][val] = { ...v, mode: m.mode, to: m.to, toId: m.toId, via: m.via };
        });
      });
      return updated;
    });
    toast.success('Fuzzy re-match complete');
  };

  const keepMatchedCreateRest = () => {
    setMasterMap(prev => {
      const updated = {};
      Object.entries(prev).forEach(([col, vals]) => {
        updated[col] = {};
        Object.entries(vals).forEach(([val, v]) => {
          updated[col][val] = v.mode === 'existing' ? v : { ...v, mode: 'new', to: val, toId: null };
        });
      });
      return updated;
    });
    toast.success('Kept all matches — unmatched values set to "Create new"');
  };

  const handleNext = () => {
    // Build resolution map: stagingCol → { fileValue → replacementValue }
    const resolution = {};
    Object.entries(masterMap || {}).forEach(([col, vals]) => {
      resolution[col] = {};
      Object.entries(vals).forEach(([fileVal, v]) => {
        if (v.mode === 'existing' && v.to !== fileVal) resolution[col][fileVal] = v.to;
        else if (v.mode === 'skip') resolution[col][fileVal] = '';
      });
    });
    patch({
      masterMapData: { resolution, masterMap, initialized: true },
      step: ws.step + 1,
    });
  };

  if (!masterMap) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-400 text-sm">
        <GitMerge className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        Loading master data…
      </div>
    );
  }

  // Stats across all tabs
  const allEntries = Object.values(masterMap).flatMap(m => Object.values(m));
  const totalDistinct = allEntries.length;
  const matchedCount  = allEntries.filter(d => d.mode === 'existing').length;
  const createCount   = allEntries.filter(d => d.mode === 'new').length;
  const skipCount     = allEntries.filter(d => d.mode === 'skip').length;
  const unresolved    = allEntries.filter(d => !['existing','new','skip'].includes(d.mode)).length;

  const activeCols = Object.keys(masterMap);
  const activeItems = activeTab ? (masterMap[activeTab] || {}) : {};
  const apiItems   = activeTab ? (apiMasters?.[COL_MASTER[activeTab]] || []) : [];

  // Apply filter + search
  const filtered = Object.entries(activeItems).filter(([val, v]) => {
    if (filterMode !== 'all' && v.mode !== filterMode) return false;
    if (search && !val.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const tabCounts = (col) => {
    const vals = Object.values(masterMap[col] || {});
    return { total: vals.length, unres: vals.filter(v => !['existing','new','skip'].includes(v.mode)).length, newC: vals.filter(v => v.mode === 'new').length };
  };

  return (
    <div className="space-y-4" data-testid="step-masters">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center">
              <GitMerge className="w-4 h-4 text-violet-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900" style={{fontFamily:'Manrope,sans-serif'}}>Master Mapping</h2>
              <p className="text-xs text-slate-500">Match each distinct value to an existing master, create new, or skip those rows</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={reMatchAll} className="h-8 text-xs border-slate-200">
              <RefreshCw className="w-3 h-3 mr-1" /> Re-match all
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={keepMatchedCreateRest} className="h-8 text-xs border-slate-200">
              <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-600" /> Keep matched, create rest
            </Button>
          </div>
        </div>

        {/* Summary tiles */}
        {totalDistinct > 0 && (
          <div className="grid grid-cols-5 gap-2 mb-4">
            {[
              [totalDistinct, 'Distinct', 'text-slate-700', 'bg-slate-50 border-slate-200'],
              [matchedCount,  'Matched',  'text-emerald-700', 'bg-emerald-50 border-emerald-200'],
              [createCount,   'Create',   'text-blue-700', 'bg-blue-50 border-blue-200'],
              [skipCount,     'Skip',     'text-amber-700', 'bg-amber-50 border-amber-200'],
              [unresolved,    'Unresolved',unresolved>0?'text-rose-700':'text-slate-400', unresolved>0?'bg-rose-50 border-rose-200':'bg-slate-50 border-slate-200'],
            ].map(([v, l, tc, bg]) => (
              <div key={l} className={`rounded-lg border p-2.5 text-center ${bg}`}>
                <div className={`text-lg font-bold ${tc}`} style={{fontFamily:'Manrope,sans-serif'}}>{v}</div>
                <div className="text-xs text-slate-500">{l}</div>
              </div>
            ))}
          </div>
        )}

        {activeCols.length === 0 ? (
          <div className="bg-slate-50 border border-dashed border-slate-200 rounded-lg p-8 text-center text-sm text-slate-400">
            No master columns mapped — continuing will skip this step
          </div>
        ) : (
          <>
            {/* Master tabs */}
            <div className="flex gap-1.5 flex-wrap border-b border-slate-200 pb-2 mb-3">
              {activeCols.map(col => {
                const { total, unres, newC } = tabCounts(col);
                const meta = MASTER_META[COL_MASTER[col]];
                return (
                  <button key={col} onClick={() => { setActiveTab(col); setSearch(''); setFilterMode('all'); }}
                    className={`px-3 py-1.5 rounded text-xs font-medium flex items-center gap-1.5 transition-colors border
                      ${activeTab === col ? 'bg-violet-50 text-violet-700 border-violet-200' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}
                    data-testid={`master-tab-${col}`}>
                    {meta?.label || col}
                    <span className="text-xs bg-slate-100 text-slate-500 rounded-full px-1.5">{total}</span>
                    {unres > 0 && <span className="text-xs bg-rose-100 text-rose-700 rounded-full px-1.5">{unres}!</span>}
                    {newC > 0 && unres === 0 && <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-1.5">+{newC}</span>}
                  </button>
                );
              })}
            </div>

            {activeTab && (
              <div>
                {/* Tab toolbar */}
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <Input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder={`Search ${MASTER_META[COL_MASTER[activeTab]]?.label || activeTab} values…`}
                    className="h-7 text-xs max-w-48 border-slate-200" />
                  <div className="flex gap-1">
                    {['all','existing','new','skip'].map(f => (
                      <button key={f} onClick={() => setFilterMode(f)}
                        className={`text-xs px-2 py-0.5 rounded border transition-colors ${filterMode===f?'bg-slate-800 text-white border-slate-800':'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                        {f==='all'?'All':f.charAt(0).toUpperCase()+f.slice(1)}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-1 ml-auto">
                    <button onClick={() => {
                      setMasterMap(prev => { const u={...prev,[activeTab]:{}}; Object.entries(prev[activeTab]).forEach(([v,d])=>{u[activeTab][v]={...d,mode:'new',to:v,toId:null}}); return u; });
                    }} className="text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded px-2 py-0.5 hover:bg-slate-50">All → Create</button>
                    <button onClick={() => {
                      const items = apiMasters?.[COL_MASTER[activeTab]] || [];
                      setMasterMap(prev => { const u={...prev,[activeTab]:{}}; Object.entries(prev[activeTab]).forEach(([v,d])=>{ const m=autoMatch(v,items); u[activeTab][v]={...d,mode:m.mode,to:m.to,toId:m.toId,via:m.via}; }); return u; });
                      toast.success(`Re-matched ${MASTER_META[COL_MASTER[activeTab]]?.label || activeTab}`);
                    }} className="text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded px-2 py-0.5 hover:bg-slate-50">
                      <RefreshCw className="w-3 h-3 inline mr-0.5" />Re-match
                    </button>
                  </div>
                </div>

                {/* Value list */}
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="overflow-y-auto max-h-64 rc-scrollbar divide-y divide-slate-50">
                    {filtered.length === 0 ? (
                      <div className="px-4 py-6 text-center text-sm text-slate-400">No values match this filter</div>
                    ) : filtered.map(([val, v]) => (
                      <div key={val}
                        className={`flex items-center gap-3 px-4 py-2 hover:bg-slate-50 transition-colors ${MODE_CLS[v.mode] ? 'border-l-2 ' + (MODE_CLS[v.mode].split(' ').find(c=>c.startsWith('border-')) || '') : ''}`}
                        data-testid={`master-val-${activeTab}-${val}`}>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-slate-700 font-medium truncate block">{val}</span>
                          <span className="text-xs text-slate-400">{v.count} row{v.count!==1?'s':''}
                            {v.via ? <span className="ml-1 text-violet-500">· via {v.via}</span> : ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Select value={v.mode} onValueChange={mode => {
                            if (mode === 'new') setDecision(activeTab, val, 'new', val, null);
                            else if (mode === 'skip') setDecision(activeTab, val, 'skip', '', null);
                            else {
                              const m = autoMatch(val, apiItems);
                              setDecision(activeTab, val, 'existing', m.to || (apiItems[0]?.name || val), m.toId);
                            }
                          }}>
                            <SelectTrigger className={`h-7 text-xs w-32 ${MODE_CLS[v.mode] || ''}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="existing">Use existing</SelectItem>
                              <SelectItem value="new">Create new</SelectItem>
                              <SelectItem value="skip">Skip rows</SelectItem>
                            </SelectContent>
                          </Select>
                          {v.mode === 'existing' && (
                            <Select value={v.to || ''} onValueChange={to => {
                              const item = apiItems.find(it => it.name === to);
                              setDecision(activeTab, val, 'existing', to, item?.id || null);
                            }}>
                              <SelectTrigger className="h-7 text-xs w-44 border-emerald-300">
                                <SelectValue placeholder="— pick —" />
                              </SelectTrigger>
                              <SelectContent>
                                {apiItems.map(it => <SelectItem key={it.id} value={it.name}>{it.name} [{it.id}]</SelectItem>)}
                              </SelectContent>
                            </Select>
                          )}
                          {v.mode === 'new' && <span className="text-xs text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded whitespace-nowrap">+Create</span>}
                          {v.mode === 'skip' && <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded whitespace-nowrap">{v.count} skipped</span>}
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

      <div className="flex items-center justify-between pt-1">
        <Button variant="outline" size="sm" onClick={() => patch({ step: ws.step - 1 })} className="h-9 text-sm border-slate-200">
          <ChevronLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <Button onClick={handleNext} className="h-9 px-6 bg-slate-900 hover:bg-slate-800 text-white text-sm"
          data-testid="wizard-masters-next">
          Next — Validate <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}
