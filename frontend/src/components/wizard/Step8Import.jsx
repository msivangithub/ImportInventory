import { useState, useEffect, useCallback, useRef } from 'react';
import { useWizard } from './WizardContext';
import api, { fmtError } from '@/lib/api';
import { toast } from 'sonner';

const PHASES = [
  { id:1, label:'Stream-validate',   done: s=>!!s },
  { id:2, label:'Bulk load staging', done: s=>['Validated','Posting','Posted','Reconciled'].includes(s) },
  { id:3, label:'Set-based post',    done: s=>['Posted','Reconciled'].includes(s), active: s=>s==='Posting' },
  { id:4, label:'Reconcile',         done: s=>s==='Reconciled', active: s=>s==='Posted' },
];

const CHUNK_COLORS = {
  Pending:'var(--wz-line-strong)', Posting:'var(--wz-warn)',
  Committed:'var(--wz-ok)', Failed:'var(--wz-err)', RolledBack:'#f97316',
};

function now() { return new Date().toLocaleTimeString('en-IN',{hour12:false}); }

export default function Step8Import() {
  const { ws, patch, goNext } = useWizard();
  const [starting,   setStarting]   = useState(false);
  const [started,    setStarted]    = useState(false);
  const [paused,     setPaused]     = useState(false);
  const [statusData, setStatusData] = useState(null);
  const [log,        setLog]        = useState([]);
  const [startTime,  setStartTime]  = useState(null);
  const logRef     = useRef(null);
  const prevChunks = useRef({});
  const { batchId, validateData, config, confirmOpts } = ws;

  const addLog = useCallback((type, msg) =>
    setLog(prev => [...prev.slice(-299), { t:now(), type, msg }])
  , []);

  const pollStatus = useCallback(async () => {
    try {
      const { data } = await api.get(`/import/${batchId}/status`);
      setStatusData(prev => {
        (data.chunks||[]).forEach(c => {
          const key = `${c.chunkNo}:${c.status}`;
          if (!prevChunks.current[key]) {
            prevChunks.current[key] = true;
            if (c.status==='Committed') addLog('ok', `Chunk #${c.chunkNo} committed · rows ${c.fromRow}–${c.toRow} · ${c.rowsOk} ok${c.mrNo?' · MR: '+c.mrNo:''}`);
            else if (c.status==='Failed') addLog('err', `Chunk #${c.chunkNo} failed: ${c.errorMsg||'unknown'}`);
          }
        });
        const prevStatus = prev?.batch?.status;
        if (data.batch?.status !== prevStatus) {
          const s = data.batch?.status;
          if (s==='Reconciled') addLog('ok', `Batch Reconciled · ${data.batch?.rowsPosted?.toLocaleString('en-IN')} rows posted${data.batch?.mrNo?' · '+data.batch.mrNo:''}`);
          else if (s==='Failed') addLog('err', `Batch Failed: ${data.batch?.lastError||'unknown'}`);
          else if (s==='Posting') addLog('info', 'Posting started — chunks processing in background…');
        }
        return data;
      });
      return data;
    } catch { return null; }
  }, [batchId, addLog]);

  // Auto-scroll log
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  // Poll while running
  useEffect(() => {
    if (!started) return;
    const batch = statusData?.batch;
    if (batch && ['Reconciled','Posted','Failed','Cancelled','RolledBack'].includes(batch.status)) return;
    if (paused) return;
    const t = setInterval(pollStatus, 2000);
    return () => clearInterval(t);
  }, [started, statusData?.batch?.status, pollStatus, paused]);

  const startPost = async () => {
    setStarting(true);
    setStartTime(Date.now());
    addLog('info', `Starting batch ${batchId}…`);
    try {
      const { data } = await api.post(`/import/${batchId}/post`, { allowErrors: true });
      if (data.started) {
        setStarted(true);
        addLog('ok', 'Batch accepted — background worker running proc_Import_Post');
        toast.success('Posting started');
        setTimeout(pollStatus, 800);
      } else {
        addLog('err', `Could not start: ${data.reason}`);
        toast.warning(data.reason || 'Could not start posting');
      }
    } catch (e) {
      const detail = e.response?.data;
      if (detail?.failures) {
        const msg = `Gate failed: ${detail.failures.map(f=>f.chk).join(', ')}`;
        addLog('err', msg); toast.error(msg);
      } else {
        addLog('err', fmtError(e)); toast.error(fmtError(e));
      }
    } finally { setStarting(false); }
  };

  const doPause = () => { setPaused(p => !p); addLog('w', paused ? 'Resumed' : 'Paused by user'); };
  const doCancel = async () => {
    if (!batchId) return;
    try {
      await api.post(`/import/${batchId}/cancel`, {});
      addLog('w', 'Cancel requested — stops at the next chunk boundary');
      toast.info('Cancel requested');
    } catch (e) { toast.error(fmtError(e)); }
  };

  const batch  = statusData?.batch;
  const chunks = statusData?.chunks || [];
  const committed  = chunks.filter(c => c.status==='Committed').length;
  const total      = chunks.length;
  const progress   = total > 0 ? Math.round(committed/total*100) : 0;
  const isReconciled = batch?.status==='Reconciled';
  const isFailed     = batch?.status==='Failed';
  const isPosting    = batch?.status==='Posting';
  const isDone = ['Reconciled','Posted','Failed','Cancelled','RolledBack'].includes(batch?.status);

  const elapsed = startTime ? (Date.now()-startTime)/1000 : 0;
  const rps = elapsed > 2 && committed > 0 ? Math.round((batch?.rowsPosted||0)/elapsed) : 0;

  const importable = (validateData?.rowsValid||0)+(validateData?.rowsWarn||0);

  // Tiles during import
  const impTiles = [
    { cls:'n',    v:(batch?.totalRows||importable).toLocaleString('en-IN'), l:'Records processed' },
    { cls:'ok',   v:(batch?.rowsPosted||committed*Math.round((importable||1)/Math.max(total,1))).toLocaleString('en-IN'), l:'Successful' },
    { cls:'err',  v:0, l:'Failed' },
    { cls:'warn', v:(validateData?.rowsError||0).toLocaleString('en-IN'), l:'Skipped' },
  ];

  // Nav
  useEffect(() => {
    patch({ nav: {
      backEnabled: !started || isDone,
      nextEnabled: isDone,
      nextLabel: 'View result →',
      statusText: batch?.status ? `Batch ${batch.status}${batch.mrNo?' · MR: '+batch.mrNo:''}` : started ? 'Importing…' : 'Waiting to start…',
    }});
  }, [isDone, started, batch?.status]); // eslint-disable-line

  return (
    <div className="stack" data-testid="step-post">
      {/* Panel head */}
      <div className="panel-head" style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, flexWrap:'wrap', marginBottom:14 }}>
        <div>
          <h2 style={{ fontSize:18, fontWeight:600 }}>Importing</h2>
          <p className="muted small" id="impSub">Streamed validation → bulk load into staging (chunks of {(confirmOpts?.chunkSize||50000).toLocaleString()}) → set-based posting per chunk → reconciliation. Pause/Cancel stops at the next chunk boundary; committed chunks stay.</p>
        </div>
        <div className="row">
          <button className="wz-btn" id="pauseBtn" type="button" onClick={doPause} disabled={!started||isDone}>
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button className="wz-btn danger" id="cancelBtn" type="button" onClick={doCancel} disabled={!started||isDone}>Cancel</button>
        </div>
      </div>

      {/* Progress card */}
      <div className="wz-card stack">
        <div className="row" style={{ justifyContent:'space-between' }}>
          <b className="mono" id="impPct" style={{ fontFamily:'var(--wz-font-mono)' }}>{started ? `${progress}%` : '0%'}</b>
          <span className="small muted" id="impEta">{rps > 0 && !isDone ? `~${rps.toLocaleString()} rows/s` : ''}</span>
        </div>
        <div className={`wz-prog ${paused?'paused':''}${isDone?'done':''}`} id="prog">
          <i style={{ width:`${progress}%` }} />
        </div>
        <div className="row" style={{ justifyContent:'space-between' }}>
          <span className="small muted" id="impStatus">
            {isReconciled ? 'Reconciled' : isFailed ? 'Failed' : isPosting ? 'Posting…' : started ? 'Processing…' : 'Preparing…'}
          </span>
          <span className="small mono" id="impCount">{committed}/{total} chunks</span>
        </div>

        {/* Phase indicators */}
        {started && (
          <div className="row small muted" id="impPhases" style={{ flexWrap:'wrap', gap:6 }}>
            {PHASES.map(ph => {
              const s = batch?.status||'';
              const isDonePhase = ph.done(s);
              const isActive    = ph.active ? ph.active(s) : false;
              return (
                <span key={ph.id} className={`wz-pill ${isDonePhase?'ok':isActive?'warn':'n'}`}>
                  {isDonePhase?'✓':isActive?'⟳':String(ph.id)} {ph.label}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Tiles */}
      {started && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))', gap:10 }}>
          {impTiles.map(t => (
            <div key={t.l} className={`wz-tile ${t.cls}`}>
              <div className="v">{t.v}</div><div className="l">{t.l}</div>
            </div>
          ))}
        </div>
      )}

      {/* Start button / reconciled state */}
      {!started && (
        <div style={{ textAlign:'center', padding:'24px 16px', background:'var(--wz-surface-2)', borderRadius:8, border:'1px dashed var(--wz-line)' }}>
          {validateData && (
            <p className="small muted" style={{ marginBottom:8 }}>
              Post <b>{importable.toLocaleString('en-IN')}</b> rows in chunks of <b>{(confirmOpts?.chunkSize||50000).toLocaleString('en-IN')}</b> via proc_StockImportwithSupplier · LEGACY mode · XACT_ABORT ON per chunk
            </p>
          )}
          <button className="wz-btn primary" onClick={startPost} disabled={starting||!batchId}
            data-testid="wizard-post-batch-btn">
            {starting ? 'Starting…' : 'Start posting'}
          </button>
        </div>
      )}

      {/* Reconciled / Failed summary */}
      {isReconciled && (
        <div className="wz-alert ok" style={{ display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ fontSize:24 }}>✓</span>
          <div>
            <b>Import Reconciled!</b>
            <div className="small">{batch?.rowsPosted?.toLocaleString('en-IN')} rows posted{batch?.mrNo ? ` · MR: ${batch.mrNo}` : ''}</div>
          </div>
        </div>
      )}
      {isFailed && (
        <div className="wz-alert err">
          <span style={{ fontSize:18 }}>✕</span>
          <div>
            <b>Posting Failed</b>
            {batch?.lastError && <div className="small">{batch.lastError}</div>}
            <button className="wz-btn sm" style={{ marginTop:8 }} onClick={startPost}>↺ Retry</button>
          </div>
        </div>
      )}

      {/* Chunk grid */}
      {chunks.length > 0 && (
        <div className="wz-card">
          <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginTop:4 }}>
            {chunks.map(c => (
              <div key={c.chunkNo}
                title={`Chunk #${c.chunkNo} — ${c.status}${c.mrNo?' · MR: '+c.mrNo:''}\nRows: ${c.fromRow}–${c.toRow} · ok: ${c.rowsOk||0}`}
                style={{ width:34,height:34,borderRadius:7,display:'grid',placeItems:'center',fontSize:11,fontWeight:700,color:'#fff',cursor:'help',background:CHUNK_COLORS[c.status]||'var(--wz-line-strong)',flexShrink:0 }}>
                {c.chunkNo}
              </div>
            ))}
          </div>
          {chunks.some(c=>c.mrNo) && (
            <div style={{ marginTop:8 }}>
              <div className="small muted" style={{ marginBottom:4 }}>MR Numbers</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                {chunks.filter(c=>c.mrNo).map(c => (
                  <span key={c.chunkNo} className="wz-pill ok" style={{ fontFamily:'var(--wz-font-mono)', fontWeight:700 }}>{c.mrNo}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Live log */}
      <div className="wz-card">
        <h3 style={{ marginBottom:8 }}>Live log</h3>
        <div ref={logRef} className="wz-log" id="impLog"
          style={{ background:'#0f151b', color:'#aeb9c3', height:200, borderColor:'#2c3842' }}>
          {log.length === 0
            ? <span style={{ color:'#44535f' }}>Waiting for events…</span>
            : log.map((e,i) => (
              <div key={i} className={e.type==='ok'?'s':e.type==='err'?'e':e.type==='w'?'w':''}>
                <span style={{ color:'#44535f', marginRight:8 }}>[{e.t}]</span>{e.msg}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
