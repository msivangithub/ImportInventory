import { useState, useEffect, useCallback, useRef } from 'react';
import api, { fmtError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { Zap, CheckCircle2, RefreshCw, ArrowRight, Layers, AlertTriangle, Terminal } from 'lucide-react';

// Four posting phases (mirrors index.html phase indicators)
const PHASES = [
  { id: 1, label: 'Stream-validate',    done: s => !!s },
  { id: 2, label: 'Bulk load staging',  done: s => ['Validated','Posting','Posted','Reconciled'].includes(s) },
  { id: 3, label: 'Set-based post',     done: s => ['Posted','Reconciled'].includes(s), active: s => s === 'Posting' },
  { id: 4, label: 'Reconcile',          done: s => s === 'Reconciled', active: s => s === 'Posted' },
];

const CHUNK_COLORS = {
  Pending: 'bg-slate-200', Posting: 'bg-amber-400 animate-pulse',
  Committed: 'bg-emerald-500', Failed: 'bg-rose-500', RolledBack: 'bg-orange-400',
};

function now() { return new Date().toLocaleTimeString('en-IN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }); }

export default function StepPost({ ws, patch, onFinish }) {
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState(false);
  const [statusData, setStatusData] = useState(null);
  const [log, setLog] = useState([]);
  const [startTime, setStartTime] = useState(null);
  const logRef = useRef(null);
  const prevChunks = useRef({});
  const { batchId } = ws;

  const addLog = useCallback((type, msg) => {
    setLog(prev => [...prev.slice(-199), { t: now(), type, msg }]);
  }, []);

  const pollStatus = useCallback(async () => {
    try {
      const { data } = await api.get(`/import/${batchId}/status`);
      setStatusData(prev => {
        // Detect new committed chunks and log them
        (data.chunks || []).forEach(c => {
          const key = `${c.chunkNo}:${c.status}`;
          if (!prevChunks.current[key]) {
            prevChunks.current[key] = true;
            if (c.status === 'Committed') {
              addLog('ok', `Chunk #${c.chunkNo} committed — rows ${c.fromRow}–${c.toRow} · ${c.rowsOk} ok${c.mrNo ? ' · MRNo: ' + c.mrNo : ''}`);
            } else if (c.status === 'Failed') {
              addLog('err', `Chunk #${c.chunkNo} failed: ${c.errorMsg || 'unknown error'}`);
            }
          }
        });
        // Log batch status transitions
        const prevStatus = prev?.batch?.status;
        if (data.batch?.status !== prevStatus) {
          const s = data.batch?.status;
          if (s === 'Reconciled') addLog('ok', `Batch Reconciled · ${data.batch?.rowsPosted?.toLocaleString('en-IN')} rows posted · ${data.batch?.mrNo || ''}`);
          else if (s === 'Failed') addLog('err', `Batch Failed: ${data.batch?.lastError || 'unknown'}`);
          else if (s === 'Posting') addLog('info', 'Posting started — chunks processing in background…');
        }
        return data;
      });
      return data;
    } catch { return null; }
  }, [batchId, addLog]);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  useEffect(() => {
    if (!started) return;
    const batch = statusData?.batch;
    if (batch && ['Reconciled','Posted','Failed','Cancelled','RolledBack'].includes(batch.status)) return;
    const t = setInterval(pollStatus, 2000);
    return () => clearInterval(t);
  }, [started, statusData?.batch?.status, pollStatus]);

  const startPost = async () => {
    setStarting(true);
    const t0 = Date.now();
    setStartTime(t0);
    addLog('info', `Starting batch ${batchId}…`);
    try {
      const { data } = await api.post(`/import/${batchId}/post`, { allowErrors: true });
      if (data.started) {
        setStarted(true);
        addLog('ok', `Batch accepted — background worker running proc_Import_Post`);
        toast.success('Posting started');
        setTimeout(pollStatus, 800);
      } else {
        addLog('err', `Could not start: ${data.reason}`);
        toast.warning(data.reason || 'Could not start posting');
      }
    } catch (e) {
      const detail = e.response?.data;
      if (detail?.failures) {
        const msg = `Gate failed: ${detail.failures.map(f => f.chk).join(', ')}`;
        addLog('err', msg); toast.error(msg);
      } else {
        addLog('err', fmtError(e)); toast.error(fmtError(e));
      }
    } finally { setStarting(false); }
  };

  const batch = statusData?.batch;
  const chunks = statusData?.chunks || [];
  const committed = chunks.filter(c => c.status === 'Committed').length;
  const total = chunks.length;
  const progress = total > 0 ? Math.round(committed / total * 100) : 0;
  const isReconciled = batch?.status === 'Reconciled';
  const isFailed = batch?.status === 'Failed';
  const isPosting = batch?.status === 'Posting';
  const isDone = ['Reconciled','Posted','Failed','Cancelled','RolledBack'].includes(batch?.status);

  // ETA
  const elapsed = startTime ? (Date.now() - startTime) / 1000 : 0;
  const rps = elapsed > 2 && committed > 0 ? Math.round((batch?.rowsPosted || 0) / elapsed) : 0;
  const remaining = total > 0 && rps > 0 && !isDone
    ? Math.ceil(((total - committed) / total) * ((batch?.totalRows || 0) / Math.max(rps, 1))) : 0;

  return (
    <div className="space-y-4" data-testid="step-post">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isReconciled ? 'bg-emerald-50' : 'bg-blue-50'}`}>
            {isReconciled ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <Zap className="w-4 h-4 text-blue-600" />}
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900" style={{fontFamily:'Manrope,sans-serif'}}>Post &amp; Reconcile</h2>
            <p className="text-xs text-slate-500">Rows posted chunk-by-chunk via proc_StockImportwithSupplier — safe to interrupt and resume</p>
          </div>
        </div>

        {/* Phase indicators */}
        {started && (
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {PHASES.map((ph, i) => {
              const s = batch?.status || '';
              const isDonePhase = ph.done(s);
              const isActivePhase = ph.active ? ph.active(s) : false;
              return (
                <span key={ph.id} className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium border
                  ${isDonePhase ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                    isActivePhase ? 'bg-amber-50 text-amber-700 border-amber-200 animate-pulse' :
                    'bg-slate-50 text-slate-400 border-slate-200'}`}>
                  {isDonePhase ? '✓' : isActivePhase ? '⟳' : String(ph.id)}
                  {ph.label}
                </span>
              );
            })}
            {rps > 0 && !isDone && (
              <span className="text-xs text-slate-400 font-mono ml-auto">
                ~{rps.toLocaleString('en-IN')} rows/s · {remaining > 0 ? `~${remaining}s remaining` : ''}
              </span>
            )}
          </div>
        )}

        {/* Reconciled success */}
        {isReconciled ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-emerald-800 mb-1" style={{fontFamily:'Manrope,sans-serif'}}>Import Reconciled!</h3>
            <p className="text-sm text-emerald-700 mb-2">All chunks committed and reconciliation passed.</p>
            {batch?.rowsPosted != null && (
              <p className="text-xs text-emerald-600 font-medium">{batch.rowsPosted.toLocaleString('en-IN')} rows posted</p>
            )}
            {batch?.mrNo && (
              <div className="mt-3 bg-white border border-emerald-200 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-1">Material Receipt Numbers</p>
                <p className="text-sm font-mono font-semibold text-emerald-700">{batch.mrNo}</p>
              </div>
            )}
          </div>
        ) : isFailed ? (
          <div className="bg-rose-50 border border-rose-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-rose-600" />
              <span className="text-sm font-semibold text-rose-800">Posting Failed</span>
            </div>
            {batch?.lastError && <p className="text-xs text-rose-700 mb-3">{batch.lastError}</p>}
            <Button size="sm" onClick={startPost} disabled={starting}
              className="h-8 text-xs bg-rose-600 hover:bg-rose-700 text-white">
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry Posting
            </Button>
          </div>
        ) : !started ? (
          <div className="bg-slate-50 border border-dashed border-slate-200 rounded-lg p-8 text-center">
            <Layers className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-600 mb-1">
              {ws.validateData && (
                <span>Post <strong>{(ws.validateData.rowsValid + ws.validateData.rowsWarn).toLocaleString('en-IN')}</strong> rows in chunks of <strong>{(ws.config?.chunkSize || 50000).toLocaleString('en-IN')}</strong></span>
              )}
            </p>
            <p className="text-xs text-slate-400 mb-4">proc_StockImportwithSupplier · LEGACY mode · XACT_ABORT ON per chunk</p>
            <Button onClick={startPost} disabled={starting} size="sm"
              className="h-9 px-6 bg-slate-900 hover:bg-slate-800 text-white text-sm"
              data-testid="wizard-post-batch-btn">
              {starting
                ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Starting…</>
                : <><Zap className="w-3.5 h-3.5 mr-1.5" />Start Posting</>}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Progress bar */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                  {isPosting && <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-500" />}
                  {batch?.status || 'Processing…'}
                </span>
                <span className="text-xs text-slate-500 font-mono">{committed}/{total} chunks</span>
              </div>
              <Progress value={progress} className="h-2.5" />
              <p className="text-xs text-slate-400 mt-1 text-right">{progress}% complete</p>
            </div>

            {/* Chunk grid */}
            {chunks.length > 0 && (
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
                  <span className="text-xs font-semibold text-slate-600">Chunk Status</span>
                </div>
                <div className="p-3 flex flex-wrap gap-2">
                  {chunks.map(c => (
                    <div key={c.chunkNo}
                      title={`Chunk #${c.chunkNo} — ${c.status}${c.mrNo ? ' · ' + c.mrNo : ''}\nRows: ${c.fromRow}–${c.toRow} · ok: ${c.rowsOk || 0}`}
                      className={`w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold text-white cursor-help ${CHUNK_COLORS[c.status] || 'bg-slate-300'}`}>
                      {c.chunkNo}
                    </div>
                  ))}
                </div>
                {chunks.some(c => c.mrNo) && (
                  <div className="px-4 py-2 border-t border-slate-100">
                    <p className="text-xs text-slate-500 mb-1 font-medium">MR Numbers</p>
                    <div className="flex flex-wrap gap-1">
                      {chunks.filter(c => c.mrNo).map(c => (
                        <span key={c.chunkNo} className="text-xs font-mono text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">{c.mrNo}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Live import log */}
        {(started || log.length > 0) && (
          <div className="mt-4 border border-slate-200 rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2 bg-slate-900 border-b border-slate-700">
              <Terminal className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-xs font-medium text-slate-400">Live import log</span>
              <span className="ml-auto text-xs text-slate-600">{log.length} events</span>
            </div>
            <div ref={logRef}
              className="font-mono text-xs bg-slate-950 text-slate-300 p-3 h-40 overflow-y-auto rc-scrollbar space-y-0.5">
              {log.length === 0
                ? <span className="text-slate-600">Waiting for events…</span>
                : log.map((entry, i) => (
                  <div key={i} className={
                    entry.type === 'ok'  ? 'text-emerald-400' :
                    entry.type === 'err' ? 'text-rose-400' :
                    'text-slate-400'}>
                    <span className="text-slate-600 mr-2">[{entry.t}]</span>{entry.msg}
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-1">
        <Button variant="outline" size="sm" onClick={() => patch({ step: 3 })} disabled={started && !isDone}
          className="h-9 text-sm border-slate-200">
          Back
        </Button>
        {isDone && (
          <Button onClick={onFinish} className="h-9 px-6 bg-emerald-600 hover:bg-emerald-700 text-white text-sm"
            data-testid="wizard-finish-btn">
            View Dashboard <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        )}
      </div>
    </div>
  );
}
