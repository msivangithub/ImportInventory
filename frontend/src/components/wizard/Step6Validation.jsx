import { useState, useCallback, useEffect } from 'react';
import { useWizard } from './WizardContext';
import api, { fmtError } from '@/lib/api';
import { toast } from 'sonner';
import { resolveRow } from '@/lib/staging';
import { PROFILES } from '@/lib/wizard-constants';

const VALIDATION_RULES = [
  "Mandatory fields","Duplicate key (profile)","Master existence",
  "Quantity ≥ 0","Numeric format (region)","Length limits",
  "Business rules","Value / rate ≥ 0","Date format (region)",
  "HBS conversion","Expiry after As-On",
];

export default function Step6Validation() {
  const { ws, patch } = useWizard();
  const [loading,     setLoading]     = useState(false);
  const [sending,     setSending]     = useState(false);
  const [sendPct,     setSendPct]     = useState(0);
  const [errData,     setErrData]     = useState(null);
  const [errPage,     setErrPage]     = useState(1);
  const [errFilter,   setErrFilter]   = useState('all');
  const [loadingErrs, setLoadingErrs] = useState(false);
  const [showRules,   setShowRules]   = useState(false);
  const [valFilter,   setValFilter]   = useState('all');

  const { batchId, validateData, columns, rows, columnMapping, transforms, applyDefaults, suppliersData, masterMapData, profile, skipErrors } = ws;
  const prof = PROFILES[profile || 'generic'] || PROFILES.generic;

  const loadErrors = useCallback(async (page = 1, filter = 'all') => {
    setLoadingErrs(true);
    try {
      const { data } = await api.get(`/import/${batchId}/errors`, { params: { page, pageSize: 50, status_filter: filter } });
      setErrData(data); setErrPage(page);
    } catch (e) { toast.error(fmtError(e)); }
    finally { setLoadingErrs(false); }
  }, [batchId]);

  const runValidate = useCallback(async () => {
    if (!rows?.length) { toast.error('No rows to validate — go back to Source'); return; }
    setSending(true); setLoading(true); setSendPct(0);
    try {
      const suppRes   = suppliersData?.resolution  || {};
      const masterRes = masterMapData?.resolution  || {};
      const resolved  = rows.map((row, idx) =>
        resolveRow(row, columns, columnMapping, transforms||{}, suppRes, masterRes, applyDefaults!==false, idx)
      );
      const BATCH_SZ = 5000;
      let nextRow = 1;
      for (let i = 0; i < resolved.length; i += BATCH_SZ) {
        const slice = resolved.slice(i, i + BATCH_SZ);
        const { data } = await api.post(`/import/${batchId}/rows`, { rows: slice, startRow: nextRow });
        nextRow = data.nextRow;
        setSendPct(Math.round((i + slice.length) / resolved.length * 50));
      }
      setSending(false);
      const { data } = await api.post(`/import/${batchId}/validate`);
      patch({ validateData: data });
      setSendPct(100);
      toast.success(`Validation: ${data.rowsValid} valid, ${data.rowsWarn} warnings, ${data.rowsError} errors`);
      if (data.rowsError > 0 || data.rowsWarn > 0) await loadErrors(1, 'all');
    } catch (e) { toast.error(fmtError(e)); }
    finally { setLoading(false); setSending(false); }
  }, [batchId, rows, columns, columnMapping, transforms, applyDefaults, suppliersData, masterMapData, patch, loadErrors]);

  const changeFilter = (f) => { setErrFilter(f); loadErrors(1, f); };

  const vd = validateData;

  // Nav
  useEffect(() => {
    patch({ nav: {
      backEnabled: true,
      nextEnabled: true, // allow proceeding even with errors (skipErrors)
      nextLabel: 'Continue →',
      statusText: vd
        ? `${vd.rowsError} errors · ${vd.rowsWarn} warnings · ${vd.rowsValid} clean`
        : 'Click "Re-run validation" to check all rows',
    }});
  }, [vd?.rowsError, vd?.rowsWarn, vd?.rowsValid]); // eslint-disable-line

  return (
    <div className="stack" data-testid="step-validate">
      {/* Panel head */}
      <div className="panel-head" style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, flexWrap:'wrap', marginBottom:8 }}>
        <div>
          <h2 style={{ fontSize:18, fontWeight:600 }}>Validation</h2>
          <p className="muted small">Each row is checked against mandatory fields, duplicates, masters, quantities, dates and business rules. The industry profile decides what counts as a duplicate.</p>
        </div>
        <div className="row">
          <div className="wz-field">
            <label>Industry profile</label>
            <select className="wz-sel" value={profile||'generic'} onChange={e => patch({ profile: e.target.value })}
              style={{ minWidth:260 }} data-testid="profile-select">
              {Object.entries(PROFILES).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
            </select>
          </div>
          <button className="wz-btn" onClick={runValidate} disabled={loading||sending}
            style={{ marginTop:'auto' }} data-testid="wizard-run-validation-btn">
            {loading ? (sending ? `Sending… ${sendPct}%` : 'Validating…') : 'Re-run validation'}
          </button>
        </div>
      </div>

      {/* Profile note */}
      <div className="wz-alert info" id="profileNote">
        <span style={{ fontSize:14 }}>ℹ</span>
        <div>
          <b>{prof.label}</b> — {prof.note}
          {' '}<span className="small muted">Line identity: {prof.key.join('+')} — repeats: {prof.dup.toLowerCase()}</span>
        </div>
      </div>

      <div className="stack">
        {/* Tiles */}
        {vd && (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))', gap:10 }}>
            {[
              { cls:'n',    v:(vd.totalRows||0).toLocaleString('en-IN'), l:'Rows checked' },
              { cls:'ok',   v:(vd.rowsValid||0).toLocaleString('en-IN'), l:'Clean' },
              { cls:'warn', v:(vd.rowsWarn||0).toLocaleString('en-IN'),  l:'Warnings' },
              { cls:'err',  v:(vd.rowsError||0).toLocaleString('en-IN'), l:'Errors' },
            ].map(t => (
              <div key={t.l} className={`wz-tile ${t.cls}`}>
                <div className="v">{t.v}</div><div className="l">{t.l}</div>
              </div>
            ))}
          </div>
        )}

        {/* Error/warning table */}
        <div className="wz-card stack">
          <div className="row" style={{ justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
            <div className="chips" id="valFilter" style={{ display:'flex', gap:6 }}>
              {[['all','All'],['err','Errors'],['warn','Warnings'],['ok','Valid']].map(([f,l]) => (
                <button key={f} className={`wz-chip ${valFilter===f?'on':''}`} type="button"
                  onClick={() => { setValFilter(f); if(f!=='ok') changeFilter(f==='err'?'errors':f==='warn'?'warnings':'all'); }}
                  data-testid={`error-filter-${f}`}>{l}</button>
              ))}
            </div>
            <label className="check small" style={{ display:'flex', gap:8, alignItems:'center', cursor:'pointer', fontSize:12 }}>
              <input type="checkbox" checked={skipErrors!==false}
                onChange={e => patch({ skipErrors: e.target.checked })}
                style={{ accentColor:'var(--wz-accent)' }} />
              Skip rows with errors (import the rest)
            </label>
          </div>

          {vd && (vd.rowsError > 0 || vd.rowsWarn > 0) ? (
            <div className="wz-tbl-wrap" style={{ maxHeight:320 }} data-testid="error-viewer-table">
              <table>
                <thead><tr>
                  <th>Row</th><th>Status</th><th>Key</th>
                  <th>Dates → HBS</th><th>Rule checks</th><th>Messages</th>
                </tr></thead>
                <tbody>
                  {loadingErrs ? (
                    <tr><td colSpan={6} style={{ textAlign:'center', color:'var(--wz-fg-3)', padding:16 }}>Loading…</td></tr>
                  ) : (errData?.rows || []).map(r => (
                    <tr key={r.rowNo} className={r.rowStatus==='E'?'r-err':r.rowStatus==='W'?'r-warn':'r-ok'}
                      data-testid={`error-row-${r.rowNo}`}>
                      <td className="num">{r.rowNo}</td>
                      <td>
                        <span className={`wz-pill ${r.rowStatus==='E'?'err':r.rowStatus==='W'?'warn':'ok'}`}>
                          {r.rowStatus==='E'?'Error':r.rowStatus==='W'?'Warning':'Valid'}
                        </span>
                      </td>
                      <td style={{ fontFamily:'var(--wz-font-mono)', fontSize:11 }}>{r.OEMCode||r.ItemCode||'—'}</td>
                      <td style={{ fontFamily:'var(--wz-font-mono)', fontSize:11 }}>
                        {[r.TransDate&&`TransDate: ${r.TransDate}`,r.ExpiryDate&&`ExpiryDate: ${r.ExpiryDate}`].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="num" style={{ fontFamily:'var(--wz-font-mono)' }}>{r.errorMsg?r.errorMsg.split(';').length:0}/{VALIDATION_RULES.length}</td>
                      <td style={{ whiteSpace:'normal', minWidth:260 }}>
                        {r.errorMsg ? r.errorMsg.split(';').filter(Boolean).map((m,i) => (
                          <div key={i} className="small" style={{ color: r.rowStatus==='E'?'var(--wz-err)':'var(--wz-warn)' }}>• {m.trim()}</div>
                        )) : <span className="muted small">All checks passed</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {errData && errData.pages > 1 && (
                <div style={{ padding:'8px 12px', display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:12, color:'var(--wz-fg-3)', borderTop:'1px solid var(--wz-line)' }}>
                  <span>{errData.total} issues · page {errPage} of {errData.pages}</span>
                  <div className="row" style={{ gap:4 }}>
                    <button className="wz-btn sm" disabled={errPage<=1} onClick={() => loadErrors(errPage-1,errFilter)}>Prev</button>
                    <button className="wz-btn sm" disabled={errPage>=errData.pages} onClick={() => loadErrors(errPage+1,errFilter)}>Next</button>
                  </div>
                </div>
              )}
            </div>
          ) : !vd ? (
            <div style={{ padding:'32px 16px', textAlign:'center', background:'var(--wz-surface-2)', borderRadius:8, color:'var(--wz-fg-3)', fontSize:12 }}>
              Click "Re-run validation" to apply all supplier + master resolutions and run {VALIDATION_RULES.length} server-side rules
            </div>
          ) : (
            <div style={{ padding:'16px', textAlign:'center', color:'var(--wz-ok)', fontSize:12 }}>
              ✓ No errors or warnings — all {(vd.rowsValid||0).toLocaleString('en-IN')} rows are clean
            </div>
          )}
        </div>

        {/* Rules applied */}
        <div className="wz-card">
          <h3 style={{ marginBottom:8 }}>Rules applied</h3>
          <div className="chips" id="ruleChips" style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {VALIDATION_RULES.map((r, i) => (
              <span key={i} className="wz-chip on" style={{ fontSize:11 }}>
                {r.replace('(profile)', `(${prof.key.join('+')})`)}
              </span>
            ))}
          </div>
        </div>

        {/* CSV download */}
        {vd && (vd.rowsError > 0 || vd.rowsWarn > 0) && batchId && (
          <div style={{ display:'flex', justifyContent:'flex-end' }}>
            <a href={`${process.env.REACT_APP_BACKEND_URL}/api/import/${batchId}/errors/csv`}
              className="wz-btn" style={{ textDecoration:'none', fontSize:12 }}
              data-testid="error-export-csv-btn">↓ Download error CSV</a>
          </div>
        )}
      </div>
    </div>
  );
}
