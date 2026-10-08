import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { fmtError } from '@/lib/api';
import AppLayout from '@/components/layout/AppLayout';
import BatchStatusBadge from '@/components/batch/BatchStatusBadge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  PlusCircle, RefreshCw, Package, CheckCircle2, AlertTriangle, Activity,
  Eye, RotateCcw, XCircle, ChevronRight, FileSpreadsheet, Clock
} from 'lucide-react';

function fmt(n) { return n == null ? '—' : Number(n).toLocaleString('en-IN'); }
function fmtDate(s) {
  if (!s) return '—';
  try { return new Date(s).toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }); }
  catch { return s; }
}

const FILTERS = ['All', 'Staging', 'Validated', 'Posting', 'Reconciled', 'Failed', 'Cancelled', 'RolledBack'];

export default function DashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('All');
  const [refreshing, setRefreshing] = useState(false);

  const handleNewImport = () => { navigate('/import/new'); };

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const { data: d } = await api.get('/dashboard/stats');
      setData(d);
    } catch (e) {
      toast.error(fmtError(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  // Auto-refresh when active batches exist
  useEffect(() => {
    if (!data?.activeBatches) return;
    const t = setInterval(() => load(true), 5000);
    return () => clearInterval(t);
  }, [data?.activeBatches, load]);

  const batches = (data?.batches || []).filter(b => filter === 'All' || b.status === filter);

  const counterCards = [
    { label: 'Total Batches', value: fmt(data?.totalBatches), icon: FileSpreadsheet, color: 'text-blue-600', bg: 'bg-blue-50', testId: 'counter-total-batches' },
    { label: 'Rows Posted Today', value: fmt(data?.rowsPostedToday), icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50', testId: 'counter-rows-posted' },
    { label: 'Error Rate (recent)', value: `${data?.errorRate ?? '—'}%`, icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50', testId: 'counter-error-rate' },
    { label: 'Active Jobs', value: fmt(data?.activeBatches), icon: Activity, color: 'text-purple-600', bg: 'bg-purple-50', testId: 'counter-active-jobs' },
  ];

  return (
    <AppLayout>
      <div className="p-6 max-w-screen-xl mx-auto">
        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900" style={{fontFamily:'Manrope,sans-serif'}}>Batch History</h1>
            <p className="text-sm text-slate-500 mt-0.5">Opening Stock import batches for your company</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing}
              className="h-8 text-xs border-slate-200 text-slate-600">
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
            </Button>
            <Button size="sm" onClick={handleNewImport}
              className="h-8 text-xs bg-slate-900 hover:bg-slate-800 text-white"
              data-testid="new-import-btn">
              <PlusCircle className="w-3.5 h-3.5 mr-1.5" /> New Import
            </Button>
          </div>
        </div>

        {/* Counter cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {counterCards.map(({ label, value, icon: Icon, color, bg, testId }) => (
            <div key={label} className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm" data-testid={testId}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-500">{label}</span>
                <div className={`w-7 h-7 rounded-md ${bg} flex items-center justify-center`}>
                  <Icon className={`w-4 h-4 ${color}`} />
                </div>
              </div>
              <div className="text-2xl font-bold text-slate-900" style={{fontFamily:'Manrope,sans-serif'}}>
                {loading ? <span className="inline-block w-16 h-7 bg-slate-100 animate-pulse rounded" /> : value}
              </div>
            </div>
          ))}
        </div>

        {/* Filter pills */}
        <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
          {FILTERS.map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${filter === f ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}>
              {f}
            </button>
          ))}
        </div>

        {/* Batch table */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden" data-testid="dashboard-batch-table">
          {loading ? (
            <div className="p-8 text-center text-slate-400 text-sm">Loading batches…</div>
          ) : batches.length === 0 ? (
            <div className="p-12 text-center">
              <Package className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-sm text-slate-500">No batches found{filter !== 'All' ? ` with status "${filter}"` : ''}</p>
              <Button size="sm" onClick={() => navigate('/import/new')} className="mt-4 h-8 text-xs bg-slate-900 text-white">
                Start your first import
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rc-scrollbar">
              <table className="w-full text-left text-xs border-collapse" style={{fontFamily:'IBM Plex Sans,sans-serif'}}>
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {['Batch ID','Source File','Status','Total','Valid','Warn','Error','Started','Actions'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {batches.map(b => (
                    <tr key={b.batchId} className="hover:bg-slate-50 transition-colors batch-row-hover" data-testid={`batch-row-${b.batchId}`}>
                      <td className="px-4 py-2.5">
                        <span className="font-mono text-xs text-slate-700 font-medium">{b.batchId}</span>
                        {b.mrNo && <div className="text-xs text-emerald-600 mt-0.5 truncate max-w-[180px]" title={b.mrNo}>{b.mrNo}</div>}
                      </td>
                      <td className="px-4 py-2.5 max-w-[160px]">
                        <div className="flex items-center gap-1.5">
                          <FileSpreadsheet className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="truncate text-slate-600" title={b.sourceName}>{b.sourceName || '—'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5"><BatchStatusBadge status={b.status} /></td>
                      <td className="px-4 py-2.5 text-right text-slate-700 font-medium">{fmt(b.totalRows)}</td>
                      <td className="px-4 py-2.5 text-right text-emerald-700">{fmt(b.rowsValid)}</td>
                      <td className="px-4 py-2.5 text-right text-amber-700">{fmt(b.rowsWarn)}</td>
                      <td className="px-4 py-2.5 text-right text-rose-600">{fmt(b.rowsError)}</td>
                      <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">
                        <div className="flex items-center gap-1 text-xs"><Clock className="w-3 h-3" />{fmtDate(b.startedAt)}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" onClick={() => navigate(`/import/${b.batchId}`)}
                            className="h-6 px-2 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                            data-testid={`view-batch-${b.batchId}`}>
                            <Eye className="w-3 h-3 mr-1" /> View
                          </Button>
                          {['Posting','Failed'].includes(b.status) && (
                            <Button variant="ghost" size="sm" onClick={() => navigate(`/import/${b.batchId}`)}
                              className="h-6 px-2 text-xs text-amber-600 hover:bg-amber-50" data-testid={`resume-${b.batchId}`}>
                              <RefreshCw className="w-3 h-3 mr-1" /> Resume
                            </Button>
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
        {data && (
          <p className="text-xs text-slate-400 mt-3 text-right">
            Showing {batches.length} of {data.batches?.length || 0} batches
          </p>
        )}
      </div>
    </AppLayout>
  );
}
