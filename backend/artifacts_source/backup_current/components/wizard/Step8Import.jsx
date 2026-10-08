import { useState, useEffect, useCallback, useRef } from 'react';
import { useWizard } from './WizardContext';
import api, { fmtError } from '@/lib/api';
import { toast } from 'sonner';

const CARD = { background:'#fff', border:'1px solid #d3dae1', borderRadius:10, boxShadow:'0 1px 3px rgba(21,32,43,.06)', padding:'18px 20px' };
const BTN_PRIMARY = { background:'#0f6e74', color:'#fff', border:'none', borderRadius:7, padding:'9px 20px', fontSize:13, fontWeight:600, cursor:'pointer' };
const BTN_OUTLINE = { background:'#fff', color:'#4b5a68', border:'1px solid #aab5c0', borderRadius:7, padding:'9px 16px', fontSize:13, fontWeight:500, cursor:'pointer' };

const PHASES = [
  { id:1, label:'Stream-validate',   done: s=>!!s },
  { id:2, label:'Bulk load staging', done: s=>['Validated','Posting','Posted','Reconciled'].includes(s) },
  { id:3, label:'Set-based post',    done: s=>['Posted','Reconciled'].includes(s), active: s=>s==='Posting' },
  { id:4, label:'Reconcile',         done: s=>s==='Reconciled', active: s=>s==='Posted' },
];

const CHUNK_COLORS = {
  Pending:'#d3dae1', Posting:'#f59e0b', Committed:'#10b981', Failed:'#ef4444', RolledBack:'#f97316',
};

function now() { return new Date().toLocaleTimeString('en-IN',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'}); }

export default function Step8Import() {
  const { ws, patch } = useWizard();
  const [starting,    setStarting]    = useState(false);
  const [started,     setStarted]     = useState(false);
  const [statusData,  setStatusData]  = useState(null);
  const [log,         setLog]         = useState([]);
  const [startTime,   setStartTime]   = useState(null);
  const logRef  = useRef(null);
  const prevChunks = useRef({});
  const { batchId, validateData, config } = ws;

  const addLog = useCallback((type, msg) => setLog(prev => [...prev.slice(-199), { t: now(), type, msg }]), []);

  const pollStatus = useCallback(async () => {
    try {
      const { data } = await api.get(`/import/${batchId}/status`);
      setStatusData(prev => {
        (data.chunks || []).forEach(c => {
          const key = `${c.chunkNo}:${c.status}`;
          if (!prevChunks.current[key]) {
            prevChunks.current[key] = true;
            if (c.status === 'Committed') addLog('ok', `Chunk #${c.chunkNo} committed · rows ${c.fromRow}–${c.toRow} · ${c.rowsOk} ok${c.mrNo?' · MR: '+c.mrNo:''}`);
            else if (c.status === 'Failed') addLog('err', `Chunk #${c.chunkNo} failed: ${c.errorMsg || 'unknown'}`);
          }
        });
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

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  useEffect(() => {
    if (!started) return;
    const batch = statusData?.batch;
    if (batch && ['Reconciled','Posted','Failed','Cancelled','RolledBack'].includes(batch.status)) return;
    const t = setInterval(pollStatus, 2000);
    return () => clearInterval(t);
  }, [started, statusData?.batch?.status, pollStatus]);

  const startPost = async () => {
    setStarting(true); setStartTime(Date.now());
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
      if (detail?.failures) { const msg = `Gate failed: ${detail.failures.map(f=>f.chk).join(', ')}`; addLog('err', msg); toast.error(msg); }
      else { addLog('err', fmtError(e)); toast.error(fmtError(e)); }
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

  const elapsed = startTime ? (Date.now() - startTime) / 1000 : 0;
  const rps = elapsed > 2 && committed > 0 ? Math.round((batch?.rowsPosted || 0) / elapsed) : 0;

  return (
    <div style={{display:'flex',flexDirection:'column',gap:16}} data-testid="step-post">
      <div style={CARD}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
          <div style={{width:32,height:32,borderRadius:8,background:isReconciled?'#dff3e5':'#dcf1f1',display:'grid',placeItems:'center',fontSize:16}}>
            {isReconciled?'✓':'⚡'}
          </div>
          <div>
            <h2 style={{fontSize:16,fontWeight:600,margin:'0 0 2px'}}>Post &amp; Reconcile</h2>
            <p style={{fontSize:12,color:'#7b8894',margin:0}}>Rows posted chunk-by-chunk via proc_StockImportwithSupplier — safe to interrupt and resume</p>
          </div>
        </div>

        {/* Phase indicators */}
        {started && (
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:14}}>
            {PHASES.map(ph => {
              const s = batch?.status || '';
              const isDonePhase = ph.done(s);
              const isActive = ph.active ? ph.active(s) : false;
              return (
                <span key={ph.id} style={{
                  display:'inline-flex',alignItems:'center',gap:5,padding:'3px 10px',borderRadius:999,fontSize:11,fontWeight:600,border:'1px solid',
                  background:isDonePhase?'#dff3e5':isActive?'#fbeed3':'#f3f5f7',
                  color:isDonePhase?'#1f7a3c':isActive?'#a4620a':'#7b8894',
                  borderColor:isDonePhase?'#1f7a3c44':isActive?'#a4620a44':'#d3dae1',
                }}>
                  {isDonePhase?'✓':isActive?'⟳':String(ph.id)} {ph.label}
                </span>
              );
            })}
            {rps > 0 && !isDone && (
              <span style={{fontSize:11,color:'#7b8894',fontFamily:'"IBM Plex Mono",monospace',marginLeft:'auto'}}>~{rps.toLocaleString()} rows/s</span>
            )}
          </div>
        )}

        {/* Reconciled */}
        {isReconciled ? (
          <div style={{background:'#dff3e5',border:'1px solid #1f7a3c44',borderRadius:10,padding:24,textAlign:'center'}}>
            <div style={{fontSize:40,marginBottom:8}}>✓</div>
            <h3 style={{fontSize:18,fontWeight:700,color:'#1f7a3c',margin:'0 0 6px'}}>Import Reconciled!</h3>
            <p style={{fontSize:13,color:'#1f7a3c',margin:'0 0 4px'}}>All chunks committed and reconciliation passed.</p>
            {batch?.rowsPosted != null && <p style={{fontSize:12,fontWeight:600,color:'#1f7a3c',margin:'0 0 10px'}}>{batch.rowsPosted.toLocaleString('en-IN')} rows posted</p>}
            {batch?.mrNo && (
              <div style={{background:'#fff',border:'1px solid #1f7a3c44',borderRadius:8,padding:10,display:'inline-block'}}>
                <p style={{fontSize:11,color:'#4b5a68',margin:'0 0 3px'}}>Material Receipt Numbers</p>
                <p style={{fontSize:13,fontFamily:'"IBM Plex Mono",monospace',fontWeight:700,color:'#1f7a3c',margin:0}}>{batch.mrNo}</p>
              </div>
            )}
            <div style={{marginTop:14}}>
              <button onClick={() => patch({ step: ws.step + 1, maxStep: Math.max(ws.maxStep, ws.step + 1) })}
                style={BTN_PRIMARY} data-testid="wizard-go-result-btn">View Result →</button>
            </div>
          </div>
        ) : isFailed ? (
          <div style={{background:'#fbe1e1',border:'1px solid #b4232344',borderRadius:8,padding:16}}>
            <p style={{fontSize:13,fontWeight:600,color:'#b42323',margin:'0 0 6px'}}>✕ Posting Failed</p>
            {batch?.lastError && <p style={{fontSize:11,color:'#b42323',margin:'0 0 10px'}}>{batch.lastError}</p>}
            <button onClick={startPost} disabled={starting} style={{...BTN_PRIMARY,background:'#b42323',display:'flex',alignItems:'center',gap:6}}>
              ↺ Retry Posting
            </button>
          </div>
        ) : !started ? (
          <div style={{background:'#f3f5f7',border:'1px dashed #d3dae1',borderRadius:8,padding:32,textAlign:'center'}}>
            {validateData && (
              <p style={{fontSize:13,color:'#4b5a68',margin:'0 0 4px'}}>
                Post <strong>{(validateData.rowsValid + validateData.rowsWarn).toLocaleString('en-IN')}</strong> rows in chunks of <strong>{(config?.chunkSize || 50000).toLocaleString('en-IN')}</strong>
              </p>
            )}
            <p style={{fontSize:11,color:'#7b8894',margin:'0 0 14px'}}>proc_StockImportwithSupplier · LEGACY mode · XACT_ABORT ON per chunk</p>
            <button onClick={startPost} disabled={starting}
              style={{...BTN_PRIMARY,display:'inline-flex',alignItems:'center',gap:6,opacity:starting?0.7:1}}
              data-testid="wizard-post-batch-btn">
              {starting ? 'Starting…' : '⚡ Start Posting'}
            </button>
          </div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            {/* Progress bar */}
            <div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                <span style={{fontSize:12,fontWeight:500,color:'#15202b',display:'flex',alignItems:'center',gap:6}}>
                  {isPosting && <span style={{animation:'spin 1s linear infinite',display:'inline-block'}}>⟳</span>}
                  {batch?.status || 'Processing…'}
                </span>
                <span style={{fontSize:11,fontFamily:'"IBM Plex Mono",monospace',color:'#7b8894'}}>{committed}/{total} chunks</span>
              </div>
              <div style={{height:12,background:'#e9edf1',borderRadius:6,overflow:'hidden',border:'1px solid #d3dae1'}}>
                <div style={{height:'100%',background:isPosting?'#f59e0b':'#10b981',width:`${progress}%`,transition:'width .3s',borderRadius:6}} />
              </div>
              <p style={{fontSize:11,color:'#7b8894',textAlign:'right',margin:'3px 0 0',fontFamily:'"IBM Plex Mono",monospace'}}>{progress}%</p>
            </div>

            {/* Chunk grid */}
            {chunks.length > 0 && (
              <div style={{border:'1px solid #d3dae1',borderRadius:8,overflow:'hidden'}}>
                <div style={{padding:'6px 12px',background:'#f3f5f7',borderBottom:'1px solid #d3dae1',fontSize:10,fontWeight:600,color:'#7b8894',textTransform:'uppercase'}}>Chunk Status</div>
                <div style={{padding:10,display:'flex',flexWrap:'wrap',gap:6}}>
                  {chunks.map(c => (
                    <div key={c.chunkNo}
                      title={`Chunk #${c.chunkNo} — ${c.status}${c.mrNo?' · '+c.mrNo:''}\nRows: ${c.fromRow}–${c.toRow} · ok: ${c.rowsOk||0}`}
                      style={{width:30,height:30,borderRadius:6,display:'grid',placeItems:'center',fontSize:11,fontWeight:700,color:'#fff',cursor:'help',background:CHUNK_COLORS[c.status]||'#d3dae1'}}>
                      {c.chunkNo}
                    </div>
                  ))}
                </div>
                {chunks.some(c => c.mrNo) && (
                  <div style={{padding:'8px 12px',borderTop:'1px solid #d3dae1'}}>
                    <p style={{fontSize:10,fontWeight:600,color:'#7b8894',margin:'0 0 5px',textTransform:'uppercase'}}>MR Numbers</p>
                    <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                      {chunks.filter(c=>c.mrNo).map(c=>(
                        <span key={c.chunkNo} style={{fontSize:11,fontFamily:'"IBM Plex Mono",monospace',fontWeight:700,color:'#1f7a3c',background:'#dff3e5',border:'1px solid #1f7a3c44',padding:'2px 8px',borderRadius:999}}>{c.mrNo}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Live log */}
        {(started || log.length > 0) && (
          <div style={{marginTop:14,border:'1px solid #2c3842',borderRadius:8,overflow:'hidden'}}>
            <div style={{display:'flex',alignItems:'center',gap:8,padding:'7px 12px',background:'#0f151b',borderBottom:'1px solid #2c3842'}}>
              <span style={{fontSize:12,color:'#7f8b96',fontFamily:'"IBM Plex Mono",monospace'}}>▶ Live import log</span>
              <span style={{marginLeft:'auto',fontSize:10,color:'#44535f'}}>{log.length} events</span>
            </div>
            <div ref={logRef}
              style={{fontFamily:'"IBM Plex Mono",monospace',fontSize:11,background:'#0f151b',color:'#aeb9c3',padding:'10px 12px',height:160,overflowY:'auto',lineHeight:1.6}}
              className="rc-scrollbar">
              {log.length === 0 ? <span style={{color:'#44535f'}}>Waiting for events…</span> :
                log.map((e, i) => (
                  <div key={i} style={{color:e.type==='ok'?'#5ccb7f':e.type==='err'?'#f07070':'#aeb9c3'}}>
                    <span style={{color:'#44535f',marginRight:8}}>[{e.t}]</span>{e.msg}
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      <div style={{display:'flex',justifyContent:'space-between',paddingTop:4}}>
        <button onClick={() => patch({ step: ws.step - 1 })} disabled={started && !isDone}
          style={{...BTN_OUTLINE, opacity:started&&!isDone?0.5:1}}>← Back</button>
        {isDone && (
          <button onClick={() => patch({ step: ws.step + 1, maxStep: Math.max(ws.maxStep, ws.step + 1) })}
            style={BTN_PRIMARY} data-testid="wizard-finish-btn">
            View Result →
          </button>
        )}
      </div>
    </div>
  );
}
