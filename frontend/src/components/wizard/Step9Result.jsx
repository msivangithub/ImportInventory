import { useState, useEffect } from 'react';
import { useWizard } from './WizardContext';
import api, { fmtError } from '@/lib/api';
import { toast } from 'sonner';
import { REGIONS } from '@/lib/wizard-constants';

const COPY_TEXT = (text, label) => {
  navigator.clipboard.writeText(text)
    .then(() => toast.success(`${label} copied to clipboard`))
    .catch(() => toast.error('Could not copy to clipboard'));
};

function fmtDate(s) {
  if (!s) return '—';
  try { return new Date(s).toLocaleString('en-IN', { day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit' }); }
  catch { return s; }
}
function dur(a, b) {
  if (!a || !b) return '—';
  const secs = Math.round((new Date(b) - new Date(a)) / 1000);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs/60)}m ${secs%60}s`;
  return `${Math.floor(secs/3600)}h ${Math.floor((secs%3600)/60)}m`;
}

export default function Step9Result({ onFinish }) {
  const { ws, patch, reset } = useWizard();
  const { batchId, validateData } = ws;
  const [batchData,  setBatchData]  = useState(null);
  const [errData,    setErrData]    = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [rbInput,    setRbInput]    = useState('');
  const [rbConfirm,  setRbConfirm]  = useState(false);
  const [rbLoading,  setRbLoading]  = useState(false);
  const [importLog,  setImportLog]  = useState([]);

  useEffect(() => {
    if (!batchId) { setLoading(false); return; }
    Promise.all([
      api.get(`/import/${batchId}`),
      api.get(`/import/${batchId}/errors`, { params: { page:1, pageSize:50, status_filter:'all' } }).catch(() => null),
    ]).then(([bRes, eRes]) => {
      setBatchData(bRes.data);
      if (eRes) setErrData(eRes.data);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [batchId]);

  const batch  = batchData?.batch;
  const chunks = batchData?.chunks || [];
  const isReconciled = batch?.status==='Reconciled';
  const isFailed     = batch?.status==='Failed';

  const doRollback = async () => {
    if (rbInput !== 'ROLLBACK') { toast.error('Type ROLLBACK to confirm'); return; }
    setRbLoading(true);
    try {
      await api.post(`/import/${batchId}/rollback`, { reason:'Rolled back from wizard result page' });
      toast.success('Rollback executed');
      const { data } = await api.get(`/import/${batchId}`);
      setBatchData(data); setRbConfirm(false);
    } catch (e) { toast.error(fmtError(e)); }
    finally { setRbLoading(false); }
  };

  // Nav
  useEffect(() => {
    patch({ nav: {
      backEnabled: false,
      nextEnabled: false,
      nextLabel: 'Done',
      statusText: batch?.status ? `Import ${batch.status}` : '',
    }});
  }, [batch?.status]); // eslint-disable-line

  const titleText = isReconciled ? 'Import completed' : isFailed ? 'Import failed' : batch?.status ? `Import ${batch.status}` : 'Import result';
  const subText   = batch ? `${ws.importType==='stock'?'Opening Stock (with Supplier)':ws.importType} · ${ws.file?.name||ws.source||''}` : '';

  if (loading) return (
    <div className="wz-card" style={{ padding:40, textAlign:'center', color:'var(--wz-fg-3)' }} data-testid="step-result">Loading result…</div>
  );

  return (
    <div className="stack" data-testid="step-result">
      {/* Panel head */}
      <div className="panel-head" style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, flexWrap:'wrap', marginBottom:14 }}>
        <div>
          <h2 style={{ fontSize:18, fontWeight:600 }} id="resTitle">{titleText}</h2>
          <p className="muted small" id="resSub">{subText}</p>
        </div>
        <div className="row">
          <button className="wz-btn" id="copyErrors" type="button" onClick={() => {
            const lines = ['Row,Outcome,Key,Reason'];
            (errData?.rows||[]).forEach(r => lines.push(`${r.rowNo},${r.rowStatus==='E'?'Error':'Warning'},"${r.OEMCode||r.ItemCode||''}","${(r.errorMsg||'').replace(/"/g,'""')}"`));
            COPY_TEXT(lines.join('\n'), 'Error report');
          }}>Copy error report</button>
          <button className="wz-btn" id="copyLog" type="button" onClick={() => COPY_TEXT(importLog.map(e=>e.msg).join('\n'), 'Import log')}>Copy import log</button>
        </div>
      </div>

      {/* Result alert */}
      <div id="resAlert" className={`wz-alert ${isReconciled?'ok':isFailed?'err':'info'}`}>
        <span style={{ fontSize:20, flexShrink:0 }}>{isReconciled?'✓':isFailed?'✕':'ℹ'}</span>
        <span>
          <b>{(batch?.rowsPosted||0).toLocaleString('en-IN')}</b> of <b>{(batch?.totalRows||validateData?.totalRows||0).toLocaleString('en-IN')}</b> records written to RetailCLIQ
          {isFailed && batch?.lastError ? `. Error: ${batch.lastError}` : ''}
          {batch?.mrNo ? ` · MR: ${batch.mrNo}` : ''}
        </span>
      </div>

      {/* Tiles */}
      {batch && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))', gap:10 }}>
          {[
            { cls:'n',    v:(batch.totalRows||0).toLocaleString('en-IN'),  l:'Total records'   },
            { cls:'ok',   v:(batch.rowsPosted||0).toLocaleString('en-IN'), l:'Rows posted'     },
            { cls:'warn', v:(batch.rowsWarn||0).toLocaleString('en-IN'),   l:'Warnings'        },
            { cls:'err',  v:(batch.rowsError||0).toLocaleString('en-IN'),  l:'Errors'          },
          ].map(t => (
            <div key={t.l} className={`wz-tile ${t.cls}`}><div className="v">{t.v}</div><div className="l">{t.l}</div></div>
          ))}
        </div>
      )}

      {/* Audit + Rollback */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
        {/* Audit */}
        <div className="wz-card">
          <h3 style={{ marginBottom:8 }}>Audit</h3>
          <dl className="wz-kv" id="auditKv">
            {[
              ['Batch ID',      <span className="mono" style={{ fontSize:11 }}>{batchId}</span>],
              ['Import type',   batch?.importType||'—'],
              ['Source',        batch?.sourceName||ws.file?.name||'—'],
              ['Branch context',batch?.branchId||ws.branchId],
              ['Region / formats', `${REGIONS[ws.region]?.name||ws.region} · ${batch?.dateOrder||ws.config?.dateOrder||'DMY'} · ${batch?.numberStyle||'DOT'}`],
              ['Date storage',  'HBS integer via englishHBS()'],
              ['Started',       fmtDate(batch?.startedAt)],
              ['Finished',      fmtDate(batch?.endedAt)],
              ['Duration',      dur(batch?.startedAt, batch?.endedAt)],
              ['Posting',       batch?.postMode||'LEGACY'],
              ['Status',        <span className={`wz-pill ${isReconciled?'ok':isFailed?'err':'info'}`}>{batch?.status||'—'}</span>],
            ].map(([k,v]) => [<dt key={k}>{k}</dt>, <dd key={k+'v'}>{v}</dd>])}
          </dl>
        </div>

        {/* Rollback */}
        <div className="wz-card stack">
          <h3>Rollback</h3>
          <p className="muted small" id="rbText">
            {isReconciled
              ? 'Reversal is supported for this import type. Rolling back removes every record this batch created and restores updated records to their previous values.'
              : batch?.rolledBackAt
              ? `This batch was rolled back on ${fmtDate(batch.rolledBackAt)}.${batch.rollbackReason ? ' Reason: '+batch.rollbackReason : ''}`
              : 'Rollback is not available — batch was not successfully committed.'}
          </p>
          {isReconciled && !batch?.rolledBackAt && (
            <div>
              {!rbConfirm ? (
                <div id="rbBox" className="row">
                  <button className="wz-btn danger" id="rbBtn" type="button" onClick={() => setRbConfirm(true)}
                    data-testid="rollback-btn">Rollback this batch</button>
                </div>
              ) : (
                <div id="rbConfirm" className="wz-alert err" style={{ flexDirection:'column', gap:8 }}>
                  <b>Roll back batch <span className="mono" id="rbBatch">{batchId}</span>?</b>
                  <span className="small">This cannot be undone. Type ROLLBACK to confirm.</span>
                  <div className="row">
                    <input className="wz-inp" value={rbInput} onChange={e => setRbInput(e.target.value)}
                      placeholder="ROLLBACK" style={{ maxWidth:180 }} id="rbInput" data-testid="rollback-input" />
                    <button className="wz-btn danger" id="rbGo" type="button" disabled={rbLoading||rbInput!=='ROLLBACK'}
                      onClick={doRollback} data-testid="rollback-confirm-btn">
                      {rbLoading ? '…' : 'Confirm rollback'}
                    </button>
                    <button className="wz-btn ghost" id="rbNo" type="button" onClick={() => { setRbConfirm(false); setRbInput(''); }}>Keep batch</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Failed & skipped rows table */}
      {errData && errData.total > 0 && (
        <div className="wz-card">
          <div className="row" style={{ justifyContent:'space-between', marginBottom:8 }}>
            <h3>Failed &amp; skipped rows</h3>
            <span className="small muted" id="errCount">{errData.total} rows</span>
          </div>
          <div className="wz-tbl-wrap" style={{ maxHeight:260 }}>
            <table id="errTable">
              <thead><tr>
                <th>Row</th><th>Outcome</th><th>Key</th><th>Reason</th>
              </tr></thead>
              <tbody>
                {(errData.rows||[]).map(r => (
                  <tr key={r.rowNo} className={r.rowStatus==='E'?'r-err':'r-warn'}>
                    <td className="num">{r.rowNo}</td>
                    <td><span className={`wz-pill ${r.rowStatus==='E'?'err':'warn'}`}>{r.rowStatus==='E'?'Error':'Warning'}</span></td>
                    <td style={{ fontFamily:'var(--wz-font-mono)', fontSize:11 }}>{r.OEMCode||r.ItemCode||'—'}</td>
                    <td style={{ whiteSpace:'normal', minWidth:260, fontSize:12 }}>{r.errorMsg}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding:'8px 12px', borderTop:'1px solid var(--wz-line)', display:'flex', justifyContent:'flex-end' }}>
            <a href={`${process.env.REACT_APP_BACKEND_URL}/api/import/${batchId}/errors/csv`}
              className="wz-btn sm" style={{ textDecoration:'none' }}
              data-testid="download-errors-btn">↓ Download CSV</a>
          </div>
        </div>
      )}

      {/* Import log */}
      <div className="wz-card">
        <h3 style={{ marginBottom:8 }}>Import log</h3>
        <div className="wz-log" id="resLog"
          style={{ background:'#0f151b', color:'#aeb9c3', borderColor:'#2c3842' }}>
          {chunks.length > 0 ? (
            chunks.map((c, i) => (
              <div key={c.chunkNo} className={c.status==='Committed'?'s':c.status==='Failed'?'e':''}>
                [{fmtDate(c.startedAt||c.endedAt)}] Chunk #{c.chunkNo} {c.status} · rows {c.fromRow}–{c.toRow} · {c.rowsOk||0} ok{c.mrNo?' · '+c.mrNo:''}
              </div>
            ))
          ) : (
            <span style={{ color:'#44535f' }}>No import log available</span>
          )}
        </div>
      </div>

      {/* Nav buttons */}
      <div className="row" style={{ justifyContent:'space-between', paddingTop:4 }}>
        <button className="wz-btn" onClick={onFinish} data-testid="go-dashboard-btn">← Dashboard</button>
        <button className="wz-btn primary" onClick={() => { reset(); window.scrollTo(0,0); }} data-testid="new-import-btn">+ New import</button>
      </div>
    </div>
  );
}
