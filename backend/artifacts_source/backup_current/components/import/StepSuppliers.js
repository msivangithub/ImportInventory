import { useState, useEffect, useRef } from 'react';
import api, { fmtError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  Users, ChevronRight, ChevronLeft, Store, UserCheck,
  UploadCloud, X, CheckCircle2, PlusCircle, AlertTriangle
} from 'lucide-react';
import { autoMatch, SAMPLE_SUPPLIERS, SUP_FIELDS, supAutoMap, parseCSV } from '@/lib/staging';

const MODES = [
  { id: 'column', icon: Store,      label: 'From the stock file',  desc: 'Distinct values of the mapped Supplier column. New names are created automatically.' },
  { id: 'single', icon: UserCheck,  label: 'Single supplier',      desc: 'All opening stock belongs to one supplier (franchise / SOR / consignment).' },
  { id: 'file',   icon: UploadCloud,label: 'Upload supplier file', desc: 'Separate CSV/Excel with GSTIN, outstanding and credit days per supplier.' },
];

export default function StepSuppliers({ ws, patch }) {
  const [mode, setMode] = useState(ws.suppliersData?.mode || 'column');
  const [apiMasters, setApiMasters] = useState(null);
  const [suppliers, setSuppliers] = useState(ws.suppliersData?.suppliers || []);
  const [singleName, setSingleName]       = useState(ws.suppliersData?.singleName || '');
  const [singleExisting, setSingleExisting] = useState(ws.suppliersData?.singleExisting || '');
  // File upload mode
  const [supCols, setSupCols]   = useState([]);
  const [supRows, setSupRows]   = useState([]);
  const [supMap,  setSupMap]    = useState({});
  const [supFile, setSupFile]   = useState(null);
  const fileRef = useRef();

  useEffect(() => {
    api.get('/masters').then(({ data }) => setApiMasters(data)).catch(() => {});
  }, []);

  // Re-derive supplier list whenever masters or uploadData changes
  useEffect(() => {
    if (!apiMasters) return;
    const { columns, allRows, columnMapping } = ws.uploadData || {};
    if (!allRows?.length) return;

    const supColEntry = Object.entries(columnMapping || {}).find(([, v]) => v === 'Supplier');
    if (!supColEntry) return;
    const supIdx = columns?.indexOf(supColEntry[0]);
    if (supIdx == null || supIdx < 0) return;

    const seen = {};
    allRows.forEach(row => { const v = (row[supIdx] || '').trim(); if (v) seen[v] = (seen[v] || 0) + 1; });

    const vendors = apiMasters.vendormaster || [];
    const newSups = Object.entries(seen).map(([name, rowCount]) => {
      const match = autoMatch(name, vendors);
      return {
        name, rowCount,
        decision: match.mode === 'existing' ? 'existing' : 'new',
        matchedTo: match.mode === 'existing' ? match.to : name,
        matchedId: match.toId,
        via: match.via,
      };
    });
    setSuppliers(prev => {
      // Preserve user edits
      return newSups.map(s => prev.find(p => p.name === s.name) || s);
    });
  }, [apiMasters, ws.uploadData]);

  const setDecision = (name, decision, matchedTo, matchedId) => {
    setSuppliers(prev => prev.map(s => s.name === name ? { ...s, decision, matchedTo, matchedId } : s));
  };

  const loadSupFile = (file) => {
    const r = new FileReader();
    r.onload = () => {
      const { columns, rows } = parseCSV(String(r.result));
      setSupCols(columns);
      setSupRows(rows);
      setSupMap(supAutoMap(columns));
      setSupFile(file);
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
      // All supplier values in allRows → this single supplier
      const { columns, allRows, columnMapping } = ws.uploadData || {};
      const supColEntry = Object.entries(columnMapping || {}).find(([, v]) => v === 'Supplier');
      if (supColEntry) {
        const supIdx = columns?.indexOf(supColEntry[0]);
        const seen = new Set();
        allRows?.forEach(row => { const v = (row[supIdx] || '').trim(); if (v) seen.add(v); });
        seen.forEach(v => { resolution[v] = val; });
      }
    } else if (mode === 'file') {
      // Map supRows supplier names to resolved values
      const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const nameIdx = Object.keys(supMap).find(i => supMap[i] === 'vend_name');
      if (nameIdx != null) {
        supRows.forEach(row => {
          const name = row[nameIdx] || '';
          if (name) resolution[name] = name; // keep as-is; backend will match
        });
      }
    }
    patch({ suppliersData: { mode, suppliers, singleName, singleExisting, resolution }, step: ws.step + 1 });
  };

  const vendors = apiMasters?.vendormaster || [];
  const newCount = suppliers.filter(s => s.decision === 'new').length;
  const existingCount = suppliers.filter(s => s.decision === 'existing').length;

  return (
    <div className="space-y-4" data-testid="step-suppliers">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
        {/* Header */}
        <div className="flex items-center gap-2 mb-5">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
            <Users className="w-4 h-4 text-indigo-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900" style={{fontFamily:'Manrope,sans-serif'}}>Suppliers</h2>
            <p className="text-xs text-slate-500">Resolve supplier values before posting — new ones will be created in vendormaster</p>
          </div>
        </div>

        {/* Mode cards */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          {MODES.map(m => {
            const Icon = m.icon;
            return (
              <button key={m.id} type="button" onClick={() => setMode(m.id)}
                className={`text-left rounded-lg border p-4 transition-all ${mode === m.id ? 'border-indigo-400 bg-indigo-50 shadow-sm' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}
                data-testid={`sup-mode-${m.id}`}>
                <div className={`w-7 h-7 rounded-md flex items-center justify-center mb-2 ${mode === m.id ? 'bg-indigo-100' : 'bg-slate-100'}`}>
                  <Icon className={`w-4 h-4 ${mode === m.id ? 'text-indigo-600' : 'text-slate-500'}`} />
                </div>
                <p className="text-xs font-semibold text-slate-800 mb-0.5">{m.label}</p>
                <p className="text-xs text-slate-500 leading-snug">{m.desc}</p>
              </button>
            );
          })}
        </div>

        {/* Single supplier */}
        {mode === 'single' && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium text-slate-700">Select existing supplier</Label>
                <Select value={singleExisting} onValueChange={setSingleExisting}>
                  <SelectTrigger className="h-9 mt-1 text-sm border-slate-200">
                    <SelectValue placeholder="— Choose from vendormaster —" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__new__"><PlusCircle className="w-3 h-3 inline mr-1" />Create new supplier…</SelectItem>
                    {vendors.map(v => <SelectItem key={v.id} value={v.name}>{v.name} [{v.id}]</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {(!singleExisting || singleExisting === '__new__') && (
                <div>
                  <Label className="text-xs font-medium text-slate-700">New supplier name</Label>
                  <Input value={singleName} onChange={e => setSingleName(e.target.value)}
                    placeholder="e.g. Raymond Apparel (franchisor)"
                    className="mt-1 h-9 text-sm border-slate-200" />
                </div>
              )}
            </div>
            <p className="text-xs text-slate-500">The Supplier column of every stock row will be set to this supplier.</p>
          </div>
        )}

        {/* Supplier file upload */}
        {mode === 'file' && (
          <div className="space-y-3">
            {!supFile ? (
              <div onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-slate-200 rounded-lg p-6 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-all">
                <UploadCloud className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-600">Drop supplier file or <span className="text-indigo-600">browse</span></p>
                <p className="text-xs text-slate-400 mt-1">Expected: Supplier Name, Code, GSTIN, Outstanding, Dr/Cr</p>
                <button type="button" onClick={e => { e.stopPropagation(); const {columns, rows} = parseCSV(SAMPLE_SUPPLIERS); setSupCols(columns); setSupRows(rows); setSupMap(supAutoMap(columns)); setSupFile({name:'suppliers_sample.csv'}); toast.success(`Sample: ${rows.length} suppliers`); }}
                  className="mt-3 text-xs text-indigo-600 border border-indigo-200 rounded px-3 py-1 hover:bg-indigo-50">
                  Load sample supplier file
                </button>
                <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={e => { if(e.target.files[0]) loadSupFile(e.target.files[0]); }} />
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2 mb-3 bg-emerald-50 border border-emerald-200 rounded-lg p-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="text-sm font-medium text-slate-700">{supFile.name}</span>
                  <span className="text-xs text-slate-400">{supRows.length} suppliers</span>
                  <button onClick={() => { setSupFile(null); setSupCols([]); setSupRows([]); setSupMap({}); }} className="ml-auto text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
                </div>
                {supCols.length > 0 && (
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <div className="bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-100">Supplier column mapping</div>
                    <div className="divide-y divide-slate-50 max-h-48 overflow-y-auto rc-scrollbar">
                      {supCols.map((col, i) => (
                        <div key={col} className="flex items-center gap-3 px-4 py-1.5 text-xs hover:bg-slate-50">
                          <span className="flex-1 font-medium text-slate-700 truncate">{col}</span>
                          <span className="text-slate-400 truncate max-w-[80px]">{supRows[0]?.[i] || '—'}</span>
                          <Select value={supMap[i] || ''} onValueChange={v => setSupMap(prev => ({ ...prev, [i]: v || undefined }))}>
                            <SelectTrigger className="h-6 text-xs w-40 border-slate-200"><SelectValue placeholder="— ignore —" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="">— Ignore —</SelectItem>
                              {SUP_FIELDS.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* From column — supplier resolution table */}
        {mode === 'column' && (
          <div className="space-y-3">
            {suppliers.length > 0 && (
              <div className="grid grid-cols-3 gap-3">
                {[
                  [suppliers.length, 'Suppliers in file',  'text-slate-800',   'bg-slate-50 border-slate-200'],
                  [existingCount,    'Matched (existing)', 'text-emerald-700', 'bg-emerald-50 border-emerald-200'],
                  [newCount,         'Will be created',    'text-blue-700',    'bg-blue-50 border-blue-200'],
                ].map(([v, l, tc, bg]) => (
                  <div key={l} className={`rounded-lg border p-3 text-center ${bg}`}>
                    <div className={`text-xl font-bold ${tc}`} style={{fontFamily:'Manrope,sans-serif'}}>{v}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{l}</div>
                  </div>
                ))}
              </div>
            )}

            {suppliers.length > 0 ? (
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Supplier resolution</span>
                  <div className="flex gap-1.5">
                    <button onClick={() => setSuppliers(p => p.map(s => ({ ...s, decision: 'new', matchedTo: s.name, matchedId: null })))}
                      className="text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded px-2 py-0.5 hover:bg-slate-50">All → Create new</button>
                    {vendors.length > 0 && (
                      <button onClick={() => {
                        setSuppliers(p => p.map(s => {
                          const m = autoMatch(s.name, vendors);
                          return m.mode === 'existing' ? { ...s, decision: 'existing', matchedTo: m.to, matchedId: m.toId } : s;
                        }));
                        toast.success('Re-applied fuzzy matching');
                      }} className="text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded px-2 py-0.5 hover:bg-slate-50">Re-match</button>
                    )}
                  </div>
                </div>
                <div className="divide-y divide-slate-50 max-h-72 overflow-y-auto rc-scrollbar">
                  {suppliers.map(sup => (
                    <div key={sup.name} className={`flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors ${sup.decision === 'existing' ? 'bg-emerald-50/20' : ''}`}
                      data-testid={`sup-row-${sup.name}`}>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-800 truncate">{sup.name}</div>
                        <div className="text-xs text-slate-400">{sup.rowCount} row{sup.rowCount !== 1 ? 's' : ''}{sup.via ? ` · matched via ${sup.via}` : ''}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Select value={sup.decision} onValueChange={v => {
                          if (v === 'new') setDecision(sup.name, 'new', sup.name, null);
                          else if (v === 'skip') setDecision(sup.name, 'skip', '', null);
                          else {
                            const first = autoMatch(sup.name, vendors);
                            setDecision(sup.name, 'existing', first.to || (vendors[0]?.name || ''), first.toId);
                          }
                        }}>
                          <SelectTrigger className={`h-7 text-xs w-32 ${sup.decision === 'existing' ? 'border-emerald-300' : sup.decision === 'skip' ? 'border-amber-300' : 'border-blue-200'}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="existing">Use existing</SelectItem>
                            <SelectItem value="new"><PlusCircle className="w-3 h-3 inline mr-1" />Create new</SelectItem>
                            <SelectItem value="skip">Skip rows</SelectItem>
                          </SelectContent>
                        </Select>
                        {sup.decision === 'existing' && (
                          <Select value={sup.matchedTo || ''} onValueChange={v => {
                            const m = vendors.find(ve => ve.name === v);
                            setDecision(sup.name, 'existing', v, m?.id || null);
                          }}>
                            <SelectTrigger className="h-7 text-xs w-44 border-emerald-300">
                              <SelectValue placeholder="— pick —" />
                            </SelectTrigger>
                            <SelectContent>{vendors.map(v => <SelectItem key={v.id} value={v.name}>{v.name} [{v.id}]</SelectItem>)}</SelectContent>
                          </Select>
                        )}
                        {sup.decision === 'new' && <span className="text-xs text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded whitespace-nowrap">+ Create</span>}
                        {sup.decision === 'skip' && <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded whitespace-nowrap">{sup.rowCount} rows skipped</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-slate-50 border border-dashed border-slate-200 rounded-lg p-6 text-center text-sm text-slate-400">
                {Object.values(ws.uploadData?.columnMapping || {}).includes('Supplier')
                  ? 'Loading supplier values from your file…'
                  : <><AlertTriangle className="w-4 h-4 inline mr-1 text-amber-500" />Supplier column not mapped — go back to Step 2 and map a column to "Supplier"</>}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-1">
        <Button variant="outline" size="sm" onClick={() => patch({ step: ws.step - 1 })} className="h-9 text-sm border-slate-200">
          <ChevronLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <Button onClick={handleNext} className="h-9 px-6 bg-slate-900 hover:bg-slate-800 text-white text-sm"
          data-testid="wizard-suppliers-next">
          Next — Master Mapping <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}
