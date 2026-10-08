import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api, { fmtError } from '@/lib/api';
import AppLayout from '@/components/layout/AppLayout';
import BatchStatusBadge, { ResultBadge } from '@/components/batch/BatchStatusBadge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  ArrowLeft, RefreshCw, RotateCcw, XCircle, CheckCircle2, AlertTriangle,
  Layers, Clock, FileText, Download, ShieldAlert, ChevronDown, ChevronUp
} from 'lucide-react';

function fmt(n) { return n == null ? '—' : Number(n).toLocaleString('en-IN'); }
function fmtDate(s) {
  if (!s) return '—';
  try { return new Date(s).toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }); }
  catch { return s; }
}

const CHUNK_STATUS = {
  Pending: 'bg-slate-100 text-slate-500', Posting: 'bg-amber-50 text-amber-700 animate-pulse',
  Committed: 'bg-emerald-50 text-emerald-700', Failed: 'bg-rose-50 text-rose-700',
  RolledBack: 'bg-orange-50 text-orange-700',
};

export default function BatchDetailPage() {
  const { batchId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [phase2, setPhase2] = useState([]);
  const [showP2, setShowP2] = useState(false);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [acting, setActing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data: d } = await api.get(`/import/${batchId}/status`);
      setData(d);
    } catch (e) { toast.error(fmtError(e)); }
    finally { if (!silent) setLoading(false); }
  }, [batchId]);

  const loadP2 = useCallback(async () => {
    const { data: d } = await api.get('/phase2');
    setPhase2(d);
  }, []);

  useEffect(() => { load(); loadP2(); }, [load, loadP2]);
  useEffect(() => {
    const batch = data?.batch;
    if (!batch || !['Posting'].includes(batch.status)) return;
    const t = setInterval(() => load(true), 2500);
    return () => clearInterval(t);
  }, [data?.batch?.status, load]);

  const batch = data?.batch;
  const chunks = data?.chunks || [];
  const committed = chunks.filter(c => c.status === 'Committed').length;
  const total = chunks.length;
  const progress = total > 0 ? Math.round(committed / total * 100) : 0;

  const doResume = async () => {
    setActing(true);
    try {
      await api.post(`/import/${batchId}/resume`);
      toast.success('Batch resumed');
      setTimeout(() => load(), 1000);
    } catch (e) { toast.error(fmtError(e)); }
    finally { setActing(false); }
  };

  const doCancel = async () => {
    if (confirm !== 'CANCEL') return;
    setActing(true);
    try {
      await api.post(`/import/${batchId}/cancel`);
      toast.success('Batch cancelled');
      setCancelOpen(false);
      setConfirm('');
      load();
    } catch (e) { toast.error(fmtError(e)); }
    finally { setActing(false); }
  };

  const doRollback = async () => {
    if (confirm !== batchId) return;
    setActing(true);
    try {
      await api.post(`/import/${batchId}/rollback`, { reason: 'User-initiated rollback from UI' });
      toast.success('Batch rolled back successfully');
      setRollbackOpen(false);
      setConfirm('');
      load();
    } catch (e) { toast.error(fmtError(e)); }
    finally { setActing(false); }
  };

  if (loading) return (
    <AppLayout>
      <div className="p-8 text-center text-slate-400 text-sm">Loading batch…</div>
    </AppLayout>
  );

  if (!batch) return (
    <AppLayout>
      <div className="p-8 text-center">
        <p className="text-slate-500">Batch not found.</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/dashboard')} className="mt-4">Back to Dashboard</Button>
      </div>
    </AppLayout>
  );

  return (
    <AppLayout>
      <div className="p-6 max-w-screen-xl mx-auto space-y-5" data-testid="batch-detail-header">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <button onClick={() => navigate('/dashboard')} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 mb-2 transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
            </button>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-slate-900 font-mono">{batchId}</h1>
              <BatchStatusBadge status={batch.status} />
              {batch.postMode && <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded border">{batch.postMode}</span>}
            </div>
            {batch.sourceName && (
              <p className="text-sm text-slate-500 mt-1 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" />{batch.sourceName}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Button variant="outline" size="sm" onClick={() => load(true)} className="h-8 text-xs border-slate-200">
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
            </Button>
            {['Posting','Failed','Validated'].includes(batch.status) && (
              <Button size="sm" onClick={doResume} disabled={acting} className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white"
                data-testid="resume-batch-btn">
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Resume
              </Button>
            )}
            {['Staging','Validated','Posting'].includes(batch.status) && (
              <Button variant="outline" size="sm" onClick={() => { setCancelOpen(true); setConfirm(''); }} disabled={acting}
                className="h-8 text-xs border-rose-200 text-rose-600 hover:bg-rose-50" data-testid="cancel-batch-btn">
                <XCircle className="w-3.5 h-3.5 mr-1.5" /> Cancel
              </Button>
            )}
            {['Posted','Reconciled','Failed','Cancelled'].includes(batch.status) && committed > 0 && (
              <Button variant="outline" size="sm" onClick={() => { setRollbackOpen(true); setConfirm(''); }} disabled={acting}
                className="h-8 text-xs border-orange-200 text-orange-600 hover:bg-orange-50" data-testid="rollback-batch-btn">
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Rollback
              </Button>
            )}
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {[
            ['Total Rows', fmt(batch.totalRows), 'text-slate-700'],
            ['Valid', fmt(batch.rowsValid), 'text-emerald-700'],
            ['Warnings', fmt(batch.rowsWarn), 'text-amber-700'],
            ['Errors', fmt(batch.rowsError), 'text-rose-600'],
            ['Posted', fmt(batch.rowsPosted), 'text-blue-700'],
            ['Gate', batch.gatePassed ? 'Passed' : 'Pending', batch.gatePassed ? 'text-emerald-700' : 'text-slate-500'],
          ].map(([l, v, cls]) => (
            <div key={l} className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm">
              <div className="text-xs text-slate-500 mb-1">{l}</div>
              <div className={`text-lg font-bold ${cls}`} style={{fontFamily:'Manrope,sans-serif'}}>{v}</div>
            </div>
          ))}
        </div>

        {/* Progress bar (when posting) */}
        {['Posting','Posted','Reconciled'].includes(batch.status) && total > 0 && (
          <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-700">Posting Progress</span>
              <span className="text-xs text-slate-500">{committed} / {total} chunks committed</span>
            </div>
            <Progress value={progress} className="h-2" />
            {batch.mrNo && <p className="text-xs text-emerald-600 mt-2 font-mono">{batch.mrNo}</p>}
          </div>
        )}

        {/* Batch info */}
        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900 mb-3" style={{fontFamily:'Manrope,sans-serif'}}>Batch Configuration</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-8 gap-y-2 text-xs">
            {[
              ['Import Type', batch.importType], ['Post Mode', batch.postMode],
              ['Date Order', batch.dateOrder], ['Number Style', batch.numberStyle],
              ['Dup Key', batch.dupKeyColumns], ['Dup Mode', batch.dupMode],
              ['DB Mode', batch.dbMode], ['Chunk Size', fmt(batch.chunkSize)],
              ['Purchase Acct', batch.purchaseAccount || '—'], ['Region', batch.region],
              ['Started', fmtDate(batch.startedAt)], ['Ended', fmtDate(batch.endedAt)],
            ].map(([k, v]) => (
              <div key={k}>
                <span className="text-slate-400">{k}</span>
                <div className="font-medium text-slate-700 mt-0.5">{v}</div>
              </div>
            ))}
          </div>
          {batch.lastError && (
            <div className="mt-3 flex items-start gap-2 bg-rose-50 border border-rose-200 rounded p-2">
              <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <p className="text-xs text-rose-700">{batch.lastError}</p>
            </div>
          )}
        </div>

        {/* Chunk grid */}
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden" data-testid="chunk-grid-container">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-slate-500" /> Chunks ({chunks.length})
            </h3>
            {['Failed','Posting','Staging'].includes(batch.status) === false && batch.rowsError > 0 && (
              <a href={`${process.env.REACT_APP_BACKEND_URL}/api/import/${batchId}/errors/csv`}
                className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 border border-blue-200 rounded px-2 py-1 hover:bg-blue-50 transition-colors"
                data-testid="error-export-csv-btn">
                <Download className="w-3.5 h-3.5" /> Error CSV
              </a>
            )}
          </div>
          {chunks.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-400">No chunks yet — validate the batch first</div>
          ) : (
            <div className="overflow-x-auto rc-scrollbar">
              <table className="w-full text-xs border-collapse">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>{['Chunk','From Row','To Row','Status','Rows OK','MR No.','Attempts','Started','Ended'].map(h => (
                    <th key={h} className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide text-left whitespace-nowrap">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {chunks.map(c => (
                    <tr key={c.chunkNo} className="hover:bg-slate-50 transition-colors" data-testid={`chunk-row-${c.chunkNo}`}>
                      <td className="px-3 py-2 font-mono font-semibold text-slate-700">#{c.chunkNo}</td>
                      <td className="px-3 py-2 text-slate-600">{fmt(c.fromRow)}</td>
                      <td className="px-3 py-2 text-slate-600">{fmt(c.toRow)}</td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${CHUNK_STATUS[c.status] || 'bg-slate-100 text-slate-600'}`}>{c.status}</span>
                      </td>
                      <td className="px-3 py-2 text-emerald-700 font-medium">{fmt(c.rowsOk)}</td>
                      <td className="px-3 py-2 font-mono text-blue-700">{c.mrNo || '—'}</td>
                      <td className="px-3 py-2 text-slate-500">{c.attempts}</td>
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{c.startedAt ? fmtDate(c.startedAt) : '—'}</td>
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{c.endedAt ? fmtDate(c.endedAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Phase 2 tracker */}
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm" data-testid="phase2-tracker-panel">
          <button className="w-full px-4 py-3 flex items-center justify-between text-left"
            onClick={() => setShowP2(!showP2)}>
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-purple-500" /> Phase 2 Tracker
              <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium">
                {phase2.filter(p => p.status === 'OPEN').length} open items
              </span>
            </h3>
            {showP2 ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </button>
          {showP2 && (
            <div className="border-t border-slate-100 divide-y divide-slate-50">
              {phase2.map(p => (
                <div key={p.id} className="px-4 py-3 flex items-start gap-3" data-testid={`phase2-item-${p.id}`}>
                  <ResultBadge result={p.status === 'OPEN' ? 'PHASE2' : p.status === 'DONE' ? 'PASS' : 'WARN'} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-slate-800">{p.item}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{p.detail}</div>
                    <div className="text-xs text-slate-400 mt-1">Area: {p.area} · Source: {p.source}</div>
                  </div>
                  <span className="text-xs text-slate-400 whitespace-nowrap">{p.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Rollback modal */}
      <Dialog open={rollbackOpen} onOpenChange={setRollbackOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-rose-700 flex items-center gap-2"><RotateCcw className="w-4 h-4" /> Rollback Batch</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="bg-rose-50 border border-rose-200 rounded p-3 text-xs text-rose-700">
              This will reverse all committed chunks (newest first) and restore staging rows to their pre-post state. This cannot be undone easily.
            </div>
            <div>
              <Label className="text-xs">Type the batch ID to confirm: <span className="font-mono font-bold">{batchId}</span></Label>
              <Input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder={batchId}
                className="mt-1 h-9 text-sm font-mono" data-testid="rollback-confirm-input" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRollbackOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={confirm !== batchId || acting}
              onClick={doRollback}
              className="bg-rose-600 hover:bg-rose-700 text-white" data-testid="rollback-confirm-btn">
              {acting ? 'Rolling back…' : 'Rollback Batch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel modal */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-800"><XCircle className="w-4 h-4 text-rose-500" /> Cancel Batch</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-slate-600">Cancellation stops posting at the next chunk boundary. Already-committed chunks remain. Use Rollback to reverse them.</p>
            <div>
              <Label className="text-xs">Type <span className="font-mono font-bold">CANCEL</span> to confirm</Label>
              <Input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="CANCEL"
                className="mt-1 h-9 text-sm font-mono" data-testid="cancel-confirm-input" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCancelOpen(false)}>Go back</Button>
            <Button size="sm" disabled={confirm !== 'CANCEL' || acting}
              onClick={doCancel}
              className="bg-rose-600 hover:bg-rose-700 text-white" data-testid="cancel-confirm-btn">
              {acting ? 'Cancelling…' : 'Cancel Batch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
