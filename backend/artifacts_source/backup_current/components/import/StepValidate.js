import { useState, useCallback } from 'react';
import api, { fmtError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  CheckCircle2, AlertTriangle, XCircle, RefreshCw,
  Download, ChevronRight, ChevronLeft, Filter, Info
} from 'lucide-react';
import { resolveRow } from '@/lib/staging';

const ROW_STATUS_CLS = {
  E: 'bg-rose-50 text-rose-700 border-rose-200',
  W: 'bg-amber-50 text-amber-700 border-amber-200',
};

const PROFILES = {
  generic:     { label: 'Generic retail',           key: ['OEMCode'],             dup: 'ERROR', note: 'One line per OEM code. Repeated OEM = double entry.' },
  apparel:     { label: 'Apparel / Footwear',        key: ['OEMCode','Size','Color'], dup: 'ALLOW', note: 'Same OEM repeats per size / colour.' },
  pharma:      { label: 'Pharma (batch + expiry)',   key: ['OEMCode','BatchNo'],   dup: 'ERROR', req: ['BatchNo','ExpiryDate'], note: 'One line per item + batch.' },
  fmcg:        { label: 'Grocery / FMCG',            key: ['OEMCode','BatchNo'],   dup: 'WARN',  note: 'Same OEM may repeat per batch.' },
  fresh:       { label: 'Fresh produce / bakery',    key: ['OEMCode','PackedDate'], dup: 'ALLOW', note: 'Weighed items repeat by packing date.' },
  jewellery:   { label: 'Jewellery',                 key: ['ItemCode'],            dup: 'ERROR', req: ['ItemCode'], note: 'Each piece has unique tag / ItemCode.' },
  electronics: { label: 'Electronics / serialised',  key: ['BatchNo'],             dup: 'ERROR', req: ['BatchNo'], note: 'BatchNo holds serial / IMEI.' },
};

const VALIDATION_RULES = [
  'ItemDescription mandatory','UOMId blank → warning','Qty mandatory / numeric',
  'Qty cannot be negative','PurchasePrice mandatory / numeric','PurchasePrice cannot be negative',
  'MRP not numeric','TransDate invalid (date order)','ExpiryDate invalid',
  'ExpiryDate before TransDate','Supplier mandatory','Category mandatory',
  'Tax mandatory','DisType must be P or A','Taxtype must be I or E',
  'InTaxtype must be I or E','PurchaseDiscountType must be P or A',
  'Supplier not in vendormaster','UOM not in UOMMaster','Tax not in Tax_Master',
  'Category not in CategoryMaster','Qty is zero → warning',
  'PurchasePrice exceeds MRP → warning','HSN (Verticle1) 4/6/8 digits → warning',
];

export default function StepValidate({ ws, patch }) {
  const [loading,       setLoading]       = useState(false);
  const [sending,       setSending]       = useState(false);
  const [sendProgress,  setSendProgress]  = useState(0);
  const [errData,       setErrData]       = useState(null);
  const [errPage,       setErrPage]       = useState(1);
  const [errFilter,     setErrFilter]     = useState('all');
  const [loadingErrors, setLoadingErrors] = useState(false);
  const [profile,       setProfile]       = useState('generic');
  const [showRules,     setShowRules]     = useState(false);

  const { batchId, validateData, uploadData, suppliersData, masterMapData } = ws;

  const loadErrors = useCallback(async (page = 1, filter = 'all') => {
    setLoadingErrors(true);
    try {
      const { data } = await api.get(`/import/${batchId}/errors`, {
        params: { page, pageSize: 50, status_filter: filter }
      });
      setErrData(data); setErrPage(page);
    } catch (e) { toast.error(fmtError(e)); }
    finally { setLoadingErrors(false); }
  }, [batchId]);

  const runValidate = useCallback(async () => {
    const { columns, allRows, columnMapping, transforms, applyDefaults } = uploadData || {};
    if (!allRows?.length) { toast.error('No file uploaded — go back to Step 2'); return; }
    setSending(true); setLoading(true); setSendProgress(0);
    try {
      // 1. Build fully-resolved rows (column mapping + transforms + supplier + master resolutions)
      const suppRes  = suppliersData?.resolution  || {};
      const masterRes = masterMapData?.resolution || {};
      const resolvedRows = allRows.map((row, idx) =>
        resolveRow(row, columns, columnMapping, transforms || {}, suppRes, masterRes, applyDefaults !== false, idx)
      );

      // 2. Send to backend in slices of 5000 (startRow=1 clears existing rows)
      const BATCH = 5000;
      let nextRow = 1;
      for (let i = 0; i < resolvedRows.length; i += BATCH) {
        const slice = resolvedRows.slice(i, i + BATCH);
        const { data } = await api.post(`/import/${batchId}/rows`, { rows: slice, startRow: nextRow });
        nextRow = data.nextRow;
        setSendProgress(Math.round((i + slice.length) / resolvedRows.length * 50)); // 0-50%
      }
      setSending(false);

      // 3. Server-side validation
      const { data } = await api.post(`/import/${batchId}/validate`);
      patch({ validateData: data });
      setSendProgress(100);
      toast.success(`Validation complete — ${data.rowsValid} valid, ${data.rowsWarn} warnings, ${data.rowsError} errors`);
      if (data.rowsError > 0 || data.rowsWarn > 0) await loadErrors(1, 'all');
    } catch (e) { toast.error(fmtError(e)); }
    finally { setLoading(false); setSending(false); }
  }, [batchId, uploadData, suppliersData, masterMapData, patch, loadErrors]);

  const changeFilter = (f) => { setErrFilter(f); loadErrors(1, f); };
  const vd = validateData;
  const prof = PROFILES[profile];

  return (
    <div className="space-y-4" data-testid="step-validate">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900" style={{fontFamily:'Manrope,sans-serif'}}>Validate Rows</h2>
              <p className="text-xs text-slate-500">Apply all {VALIDATION_RULES.length} rules · resolutions from Suppliers + Masters applied automatically</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 whitespace-nowrap">Profile:</span>
              <Select value={profile} onValueChange={setProfile}>
                <SelectTrigger className="h-8 text-xs border-slate-200 w-52" data-testid="profile-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PROFILES).map(([k, p]) => <SelectItem key={k} value={k}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={runValidate} disabled={loading || sending} size="sm"
              className="h-8 px-4 bg-blue-600 hover:bg-blue-700 text-white text-xs"
              data-testid="wizard-run-validation-btn">
              {loading
                ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />{sending?`Sending… ${sendProgress}%`:'Validating…'}</>
                : <><RefreshCw className="w-3.5 h-3.5 mr-1.5" />Run Validation</>}
            </Button>
          </div>
        </div>

        {/* Profile note */}
        <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-100 rounded-lg mb-4 text-xs">
          <Info className="w-3.5 h-3.5 text-blue-600 mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold text-blue-800">{prof.label}</span>
            <span className="text-blue-700"> — {prof.note} </span>
            <span className="text-blue-500">Dup key: <code className="bg-blue-100 px-1 rounded">{prof.key.join(' + ')}</code> · mode: {prof.dup}</span>
          </div>
        </div>

        {/* Results */}
        {vd ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { v: vd.totalRows, l: 'Total Rows',  cls: 'border-slate-200 bg-slate-50',    t: 'text-slate-800' },
              { v: vd.rowsValid, l: 'Valid',        cls: 'border-emerald-200 bg-emerald-50', t: 'text-emerald-800', icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> },
              { v: vd.rowsWarn,  l: 'Warnings',     cls: 'border-amber-200 bg-amber-50',    t: 'text-amber-800',   icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> },
              { v: vd.rowsError, l: 'Errors',       cls: 'border-rose-200 bg-rose-50',      t: 'text-rose-800',    icon: <XCircle className="w-3.5 h-3.5 text-rose-500" /> },
            ].map(({ v, l, cls, t, icon }) => (
              <div key={l} className={`border rounded-lg p-3 text-center ${cls}`}>
                <div className={`text-2xl font-bold ${t} flex items-center justify-center gap-1`} style={{fontFamily:'Manrope,sans-serif'}}>
                  {icon}{(v ?? 0).toLocaleString('en-IN')}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">{l}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-slate-50 border border-dashed border-slate-200 rounded-lg p-8 text-center text-sm text-slate-400">
            Clicking "Run Validation" will apply all supplier + master resolutions, send rows to the server, then run all {VALIDATION_RULES.length} rules
          </div>
        )}

        {/* Rules toggle */}
        <button onClick={() => setShowRules(!showRules)} className="mt-3 text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
          <Info className="w-3 h-3" />{showRules ? 'Hide' : 'Show'} {VALIDATION_RULES.length} rules applied
        </button>
        {showRules && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {VALIDATION_RULES.map((r, i) => (
              <span key={i} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded border border-slate-200">{i+1}. {r}</span>
            ))}
          </div>
        )}
      </div>

      {/* Error table */}
      {vd && (vd.rowsError > 0 || vd.rowsWarn > 0) && (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden" data-testid="error-viewer-table">
          <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Validation Issues</h3>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1 text-xs">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                {[['all','All'],['errors','Errors'],['warnings','Warnings']].map(([v,l]) => (
                  <button key={v} onClick={() => changeFilter(v)}
                    className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${errFilter===v?'bg-slate-800 text-white':'text-slate-500 hover:bg-slate-100'}`}
                    data-testid={`error-filter-${v}`}>{l}</button>
                ))}
              </div>
              <a href={`${process.env.REACT_APP_BACKEND_URL}/api/import/${batchId}/errors/csv`}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 border border-blue-200 rounded px-2 py-1 hover:bg-blue-50 transition-colors"
                data-testid="error-export-csv-btn">
                <Download className="w-3.5 h-3.5" /> Download CSV
              </a>
            </div>
          </div>
          <div className="overflow-x-auto rc-scrollbar max-h-72">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-slate-50 sticky top-0 border-b border-slate-100">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-slate-500 whitespace-nowrap">Row #</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-500 whitespace-nowrap">Type</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-500">Error / Warning</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-500">Description</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-500">Supplier</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-500">Category</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-500 whitespace-nowrap">Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {loadingErrors
                  ? <tr><td colSpan={7} className="px-4 py-4 text-center text-slate-400">Loading…</td></tr>
                  : (errData?.rows || []).map(r => (
                    <tr key={r.rowNo} className="hover:bg-slate-50 transition-colors" data-testid={`error-row-${r.rowNo}`}>
                      <td className="px-3 py-1.5 font-mono font-medium text-slate-600">{r.rowNo}</td>
                      <td className="px-3 py-1.5">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-semibold border ${ROW_STATUS_CLS[r.rowStatus]||''}`}>
                          {r.rowStatus==='E'?'Error':'Warn'}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-slate-600 max-w-[280px]"><div className="truncate" title={r.errorMsg}>{r.errorMsg}</div></td>
                      <td className="px-3 py-1.5 text-slate-600 max-w-[160px] truncate">{r.ItemDescription}</td>
                      <td className="px-3 py-1.5 text-slate-600 max-w-[120px] truncate">{r.Supplier}</td>
                      <td className="px-3 py-1.5 text-slate-600">{r.Category}</td>
                      <td className="px-3 py-1.5 text-slate-600 font-mono">{r.Qty}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {errData && errData.pages > 1 && (
            <div className="px-4 py-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>{errData.total} issues · page {errPage} of {errData.pages}</span>
              <div className="flex gap-1">
                <button disabled={errPage<=1} onClick={()=>loadErrors(errPage-1,errFilter)} className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">Prev</button>
                <button disabled={errPage>=errData.pages} onClick={()=>loadErrors(errPage+1,errFilter)} className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">Next</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <Button variant="outline" size="sm" onClick={() => patch({ step: ws.step - 1 })} className="h-9 text-sm border-slate-200">
          <ChevronLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <Button onClick={() => patch({ step: ws.step + 1 })} disabled={!vd}
          className="h-9 px-6 bg-slate-900 hover:bg-slate-800 text-white text-sm"
          data-testid="wizard-validate-next">
          Next — Gate Check <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}
