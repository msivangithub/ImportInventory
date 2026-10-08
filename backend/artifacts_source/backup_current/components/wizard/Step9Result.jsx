import { useState, useEffect } from 'react';
import { useWizard } from './WizardContext';
import api, { fmtError } from '@/lib/api';
import { toast } from 'sonner';

const CARD = { background:'#fff', border:'1px solid #d3dae1', borderRadius:10, boxShadow:'0 1px 3px rgba(21,32,43,.06)', padding:'18px 20px' };
const BTN_PRIMARY = { background:'#0f6e74', color:'#fff', border:'none', borderRadius:7, padding:'9px 20px', fontSize:13, fontWeight:600, cursor:'pointer' };
const BTN_DANGER  = { background:'#b42323', color:'#fff', border:'none', borderRadius:7, padding:'9px 20px', fontSize:13, fontWeight:600, cursor:'pointer' };
const BTN_OUTLINE = { background:'#fff', color:'#4b5a68', border:'1px solid #aab5c0', borderRadius:7, padding:'9px 16px', fontSize:13, fontWeight:500, cursor:'pointer' };

function fmtDate(s) {
  if (!s) return '—';
  try { return new Date(s).toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }); }
  catch { return s; }
}

export default function Step9Result({ onFinish }) {
  const { ws, reset } = useWizard();
  const { batchId } = ws;
  const [batchData,  setBatchData]  = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [rbInput,    setRbInput]    = useState('');
  const [rbConfirm,  setRbConfirm]  = useState(false);
  const [rbLoading,  setRbLoading]  = useState(false);

  useEffect(() => {
    if (!batchId) { setLoading(false); return; }
    api.get(`/import/${batchId}`).then(({ data }) => { setBatchData(data); setLoading(false); }).catch(() => setLoading(false));
  }, [batchId]);

  const batch = batchData?.batch;
  const chunks = batchData?.chunks || [];
  const isReconciled = batch?.status === 'Reconciled';
  const isFailed = batch?.status === 'Failed';

  const doRollback = async () => {
    if (rbInput !== 'ROLLBACK') { toast.error('Type ROLLBACK to confirm'); return; }
    setRbLoading(true);
    try {
      await api.post(`/import/${batchId}/rollback`, { reason: 'Rolled back from wizard result page' });
      toast.success('Rollback executed successfully');
      const { data } = await api.get(`/import/${batchId}`);
      setBatchData(data); setRbConfirm(false);
    } catch (e) { toast.error(fmtError(e)); }
    finally { setRbLoading(false); }
  };

  if (loading) {
    return <div style={{...CARD, textAlign:'center', padding:40, color:'#7b8894', fontSize:13}}>Loading result…</div>;
  }

  const Tile = ({ v, l, color, bg }) => (
    <div style={{border:`1px solid ${bg}55`,background:bg,borderRadius:8,padding:'10px 14px',borderLeft:`4px solid ${color}`}}>
      <div style={{fontSize:20,fontWeight:700,color,fontVariantNumeric:'tabular-nums'}}>{v ?? '—'}</div>
      <div style={{fontSize:11,color:'#7b8894',marginTop:2}}>{l}</div>
    </div>
  );

  return (
    <div style={{display:'flex',flexDirection:'column',gap:16}} data-testid="step-result">

      {/* Status banner */}
      <div style={{
        ...CARD,
        background:isReconciled?'#dff3e5':isFailed?'#fbe1e1':'#e0eafb',
        border:`1px solid ${isReconciled?'#1f7a3c44':isFailed?'#b4232344':'#2457a844'}`,
        display:'flex',alignItems:'center',gap:14,
      }}>
        <div style={{fontSize:36}}>{isReconciled?'✓':isFailed?'✕':'ℹ'}</div>
        <div>
          <h2 style={{fontSize:18,fontWeight:700,margin:'0 0 3px',color:isReconciled?'#1f7a3c':isFailed?'#b42323':'#2457a8'}}>
            {isReconciled ? 'Import Completed Successfully' : isFailed ? 'Import Failed' : `Import ${batch?.status || 'In Progress'}`}
          </h2>
          {batch?.mrNo && <p style={{fontSize:13,margin:'0 0 2px',fontFamily:'"IBM Plex Mono",monospace',color:'#1f7a3c',fontWeight:600}}>MR Numbers: {batch.mrNo}</p>}
          {batch?.lastError && <p style={{fontSize:12,margin:0,color:'#b42323'}}>{batch.lastError}</p>}
        </div>
      </div>

      {/* Summary tiles */}
      {batch && (
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))',gap:10}}>
          <Tile v={(batch.totalRows||0).toLocaleString('en-IN')}  l="Total Rows"    color="#15202b" bg="#f3f5f7" />
          <Tile v={(batch.rowsValid||0).toLocaleString('en-IN')}  l="Valid"         color="#1f7a3c" bg="#dff3e5" />
          <Tile v={(batch.rowsWarn||0).toLocaleString('en-IN')}   l="Warnings"      color="#a4620a" bg="#fbeed3" />
          <Tile v={(batch.rowsError||0).toLocaleString('en-IN')}  l="Errors"        color="#b42323" bg="#fbe1e1" />
          <Tile v={(batch.rowsPosted||0).toLocaleString('en-IN')} l="Rows posted"   color="#0f6e74" bg="#dcf1f1" />
        </div>
      )}

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
        {/* Audit card */}
        <div style={CARD}>
          <h3 style={{fontSize:13,fontWeight:600,margin:'0 0 12px'}}>Audit trail</h3>
          <dl style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:'5px 14px',fontSize:12,margin:0}}>
            {[
              ['Batch ID',      batchId],
              ['Source file',   batch?.sourceName || '—'],
              ['Started',       fmtDate(batch?.startedAt)],
              ['Ended',         fmtDate(batch?.endedAt)],
              ['Import type',   batch?.importType || '—'],
              ['Post mode',     batch?.postMode || '—'],
              ['Purchase A/c',  batch?.purchaseAccount || '—'],
              ['Status',        batch?.status || '—'],
            ].map(([k,v]) => (
              <>
                <dt key={k} style={{color:'#7b8894',whiteSpace:'nowrap'}}>{k}</dt>
                <dd key={k+'v'} style={{margin:0,fontWeight:k==='Batch ID'?500:400,fontFamily:k==='Batch ID'?'"IBM Plex Mono",monospace':'inherit',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{v}</dd>
              </>
            ))}
          </dl>
        </div>

        {/* Rollback card */}
        <div style={CARD}>
          <h3 style={{fontSize:13,fontWeight:600,margin:'0 0 8px'}}>Rollback</h3>
          {batch?.rolledBackAt ? (
            <div style={{background:'#fbeed3',border:'1px solid #a4620a44',borderRadius:7,padding:'8px 12px',fontSize:12,color:'#a4620a'}}>
              This batch was rolled back on {fmtDate(batch.rolledBackAt)}
              {batch.rollbackReason && <div style={{marginTop:3}}>Reason: {batch.rollbackReason}</div>}
            </div>
          ) : chunks.some(c => c.status === 'Committed') ? (
            <div>
              <p style={{fontSize:12,color:'#4b5a68',margin:'0 0 10px',lineHeight:1.5}}>
                Rollback removes every record this batch created and restores updated records to their previous values.
              </p>
              {!rbConfirm ? (
                <button onClick={() => setRbConfirm(true)} style={BTN_DANGER}
                  data-testid="rollback-btn">Rollback this batch</button>
              ) : (
                <div style={{background:'#fbe1e1',border:'1px solid #b4232344',borderRadius:8,padding:12,display:'flex',flexDirection:'column',gap:8}}>
                  <p style={{fontSize:12,fontWeight:600,color:'#b42323',margin:0}}>
                    Roll back batch <span style={{fontFamily:'"IBM Plex Mono",monospace'}}>{batchId}</span>?
                  </p>
                  <p style={{fontSize:11,color:'#4b5a68',margin:0}}>This cannot be undone. Type ROLLBACK to confirm.</p>
                  <div style={{display:'flex',gap:6}}>
                    <input value={rbInput} onChange={e => setRbInput(e.target.value)}
                      placeholder="ROLLBACK"
                      style={{flex:1,height:32,padding:'0 10px',fontSize:12,border:'1px solid #b42323',borderRadius:5,fontFamily:'inherit'}}
                      data-testid="rollback-input" />
                    <button onClick={doRollback} disabled={rbLoading || rbInput !== 'ROLLBACK'}
                      style={{...BTN_DANGER, opacity:(rbLoading||rbInput!=='ROLLBACK')?0.5:1, padding:'0 14px'}}
                      data-testid="rollback-confirm-btn">
                      {rbLoading ? '…' : 'Confirm'}
                    </button>
                    <button onClick={() => { setRbConfirm(false); setRbInput(''); }} style={BTN_OUTLINE}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p style={{fontSize:12,color:'#7b8894',margin:0}}>No committed chunks — rollback not available.</p>
          )}
        </div>
      </div>

      {/* Chunk result grid */}
      {chunks.length > 0 && (
        <div style={CARD}>
          <h3 style={{fontSize:13,fontWeight:600,margin:'0 0 10px'}}>Chunk summary</h3>
          <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
            {chunks.map(c => (
              <div key={c.chunkNo}
                title={`Chunk #${c.chunkNo} — ${c.status}${c.mrNo?' · MR: '+c.mrNo:''}\nRows: ${c.fromRow}–${c.toRow} · ok: ${c.rowsOk||0}`}
                style={{
                  width:34,height:34,borderRadius:6,display:'grid',placeItems:'center',fontSize:11,fontWeight:700,
                  color:'#fff',cursor:'help',
                  background:c.status==='Committed'?'#10b981':c.status==='Failed'?'#ef4444':c.status==='RolledBack'?'#f97316':'#d3dae1',
                }}>
                {c.chunkNo}
              </div>
            ))}
          </div>
          {chunks.some(c => c.mrNo) && (
            <div style={{marginTop:10}}>
              <p style={{fontSize:10,fontWeight:600,color:'#7b8894',margin:'0 0 5px',textTransform:'uppercase'}}>MR Numbers</p>
              <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                {chunks.filter(c => c.mrNo).map(c => (
                  <span key={c.chunkNo} style={{fontSize:12,fontFamily:'"IBM Plex Mono",monospace',fontWeight:700,color:'#1f7a3c',background:'#dff3e5',border:'1px solid #1f7a3c44',padding:'3px 10px',borderRadius:999}}>{c.mrNo}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error report download */}
      {batch?.rowsError > 0 && (
        <div style={CARD}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>
              <h3 style={{fontSize:13,fontWeight:600,margin:'0 0 2px'}}>Error report</h3>
              <p style={{fontSize:11,color:'#7b8894',margin:0}}>{batch.rowsError} error rows not imported</p>
            </div>
            <a href={`${process.env.REACT_APP_BACKEND_URL}/api/import/${batchId}/errors/csv`}
              style={{...BTN_OUTLINE, fontSize:12, textDecoration:'none', display:'inline-flex', alignItems:'center', gap:5}}
              data-testid="download-errors-btn">
              ↓ Download CSV
            </a>
          </div>
        </div>
      )}

      {/* Nav */}
      <div style={{display:'flex',justifyContent:'space-between',paddingTop:4}}>
        <button onClick={onFinish} style={BTN_OUTLINE} data-testid="go-dashboard-btn">← Dashboard</button>
        <button onClick={() => { reset(); }} style={BTN_PRIMARY} data-testid="new-import-btn">+ New Import</button>
      </div>
    </div>
  );
}
