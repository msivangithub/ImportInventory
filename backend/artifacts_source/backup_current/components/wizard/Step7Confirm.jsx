import { useState, useCallback } from 'react';
import { useWizard } from './WizardContext';
import api, { fmtError } from '@/lib/api';
import { toast } from 'sonner';

const CARD = { background:'#fff', border:'1px solid #d3dae1', borderRadius:10, boxShadow:'0 1px 3px rgba(21,32,43,.06)', padding:'18px 20px' };
const BTN_PRIMARY = { background:'#0f6e74', color:'#fff', border:'none', borderRadius:7, padding:'9px 20px', fontSize:13, fontWeight:600, cursor:'pointer' };
const BTN_OUTLINE = { background:'#fff', color:'#4b5a68', border:'1px solid #aab5c0', borderRadius:7, padding:'9px 16px', fontSize:13, fontWeight:500, cursor:'pointer' };

const RESULT_BADGE = {
  PASS:   { bg:'#dff3e5', color:'#1f7a3c', label:'PASS' },
  FAIL:   { bg:'#fbe1e1', color:'#b42323', label:'FAIL' },
  WARN:   { bg:'#fbeed3', color:'#a4620a', label:'WARN' },
  PHASE2: { bg:'#ede9fe', color:'#6d28d9', label:'PHASE2' },
};

function buildTsqlPlan(ws) {
  const b = ws.batchId, cfg = ws.config || {}, vd = ws.validateData;
  return [
    `-- BatchId: ${b || '?'}`,
    `-- ${vd?.totalRows || 0} rows staged in dbo.Stock_Import_Export`,
    ``,
    `-- 1. Server-side validation (24 rules):`,
    `EXEC dbo.proc_Import_Validate @BatchId = '${b || '?'}';`,
    ``,
    `-- 2. Final gate check:`,
    `EXEC dbo.proc_Import_Gate @BatchId = '${b || '?'}', @AllowErrors = 0;`,
    ``,
    `-- 3. Post in chunks of ${(cfg.chunkSize||50000).toLocaleString()}:`,
    `EXEC dbo.proc_Import_Post @BatchId = '${b || '?'}', @MaxChunks = 2;  -- loops until done`,
    ``,
    `-- 4. proc_StockImportwithSupplier per chunk:`,
    `EXEC dbo.proc_StockImportwithSupplier`,
    `  @CompId          = 'RCLQ01',`,
    `  @UserId          = '${cfg.userId || 'U10001'}',`,
    `  @BranchId        = 'BMS10001',`,
    `  @PurchaseAccount = '${cfg.purchaseAccount || '(none)'}',`,
    `  @MRNo            = @MRNo OUTPUT,`,
    `  @GSTXml          = '<GST>...</GST>';`,
    ``,
    `-- 5. Reconcile (row count match):`,
    `EXEC dbo.proc_Import_Reconcile @BatchId = '${b || '?'}';`,
  ].join('\n');
}

export default function Step7Confirm() {
  const { ws, patch } = useWizard();
  const [loading,   setLoading]   = useState(false);
  const [allowErrs, setAllowErrs] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [showTsql,  setShowTsql]  = useState(false);
  const { batchId, gateData, validateData, config } = ws;

  const runGate = useCallback(async () => {
    setLoading(true); setConfirmed(false);
    try {
      const { data } = await api.post(`/import/${batchId}/gate`, { allowErrors: allowErrs });
      patch({ gateData: data });
      if (data.gate?.gatePassed) toast.success('Gate passed — confirm below to proceed');
      else toast.warning(`Gate has ${data.gate?.failures} failure(s)`);
    } catch (e) { toast.error(fmtError(e)); }
    finally { setLoading(false); }
  }, [batchId, allowErrs, patch]);

  const gd = gateData;
  const gatePassed = gd?.gate?.gatePassed;
  const canProceed = gatePassed && confirmed;

  const Tile = ({ v, l, color, bg }) => (
    <div style={{border:`1px solid ${bg}55`,background:bg,borderRadius:8,padding:'10px 14px',borderLeft:`4px solid ${color}`}}>
      <div style={{fontSize:20,fontWeight:700,color,fontVariantNumeric:'tabular-nums'}}>{(v??0).toLocaleString('en-IN')}</div>
      <div style={{fontSize:11,color:'#7b8894',marginTop:2}}>{l}</div>
    </div>
  );

  return (
    <div style={{display:'flex',flexDirection:'column',gap:16}} data-testid="step-gate">

      {/* Import summary */}
      {validateData && (
        <div style={CARD}>
          <h3 style={{fontSize:13,fontWeight:600,margin:'0 0 12px'}}>Import summary</h3>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))',gap:10,marginBottom:14}}>
            <Tile v={validateData.totalRows} l="Total"    color="#15202b" bg="#f3f5f7" />
            <Tile v={validateData.rowsValid} l="Valid"    color="#1f7a3c" bg="#dff3e5" />
            <Tile v={validateData.rowsWarn}  l="Warnings" color="#a4620a" bg="#fbeed3" />
            <Tile v={validateData.rowsError} l="Errors"   color="#b42323" bg="#fbe1e1" />
            <Tile v={validateData.rowsValid + validateData.rowsWarn} l="Will import" color="#0f6e74" bg="#dcf1f1" />
          </div>
          <dl style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:'5px 16px',fontSize:12}}>
            {[
              ['Purchase account', config?.purchaseAccount || '—'],
              ['Date order',       config?.dateOrder || '—'],
              ['Number style',     config?.numberStyle || '—'],
              ['Chunk size',       (config?.chunkSize || 50000).toLocaleString('en-IN')],
              ['Remarks',          config?.remarks || '—'],
            ].map(([k,v]) => (
              <><dt key={k} style={{color:'#7b8894',whiteSpace:'nowrap'}}>{k}</dt>
              <dd key={k+'v'} style={{margin:0,fontWeight:500}}>{v}</dd></>
            ))}
          </dl>
        </div>
      )}

      {/* Gate check */}
      <div style={CARD} data-testid="preflight-panel">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
          <div>
            <h2 style={{fontSize:16,fontWeight:600,margin:'0 0 3px'}}>Pre-flight gate</h2>
            <p style={{fontSize:12,color:'#7b8894',margin:0}}>All checks must PASS before posting can begin</p>
          </div>
          <button onClick={runGate} disabled={loading}
            style={{...BTN_PRIMARY, opacity:loading?0.7:1, display:'flex', alignItems:'center', gap:6}}
            data-testid="preflight-recheck-btn">
            {loading ? 'Checking…' : '▶ Run Gate Check'}
          </button>
        </div>

        {/* Allow errors toggle */}
        <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',background:'#fbeed3',border:'1px solid #a4620a44',borderRadius:7,padding:'8px 12px',marginBottom:12,fontSize:12,color:'#a4620a'}}>
          <input type="checkbox" checked={allowErrs} onChange={e => setAllowErrs(e.target.checked)}
            style={{accentColor:'#0f6e74'}} data-testid="allow-errors-checkbox" />
          Allow error rows — they will be skipped during posting (valid + warning rows proceed)
        </label>

        {gd ? (
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {/* Gate summary */}
            <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',borderRadius:8,background:gatePassed?'#dff3e5':'#fbe1e1',border:`1px solid ${gatePassed?'#1f7a3c44':'#b4232344'}`}}>
              <span style={{fontSize:18}}>{gatePassed?'✓':'✕'}</span>
              <div>
                <p style={{fontSize:13,fontWeight:600,margin:0,color:gatePassed?'#1f7a3c':'#b42323'}}>
                  {gatePassed ? 'Gate Passed — Ready to Post' : `Gate Failed — ${gd.gate.failures} issue(s) to resolve`}
                </p>
                {gd.gate.phase2Open > 0 && (
                  <p style={{fontSize:11,color:'#6d28d9',margin:0}}>{gd.gate.phase2Open} Phase 2 items tracked (not blocking)</p>
                )}
              </div>
            </div>

            {/* Check list */}
            <div style={{border:'1px solid #d3dae1',borderRadius:8,overflow:'hidden'}}>
              <table style={{borderCollapse:'collapse',width:'100%',fontSize:12}}>
                <thead>
                  <tr style={{background:'#f3f5f7',borderBottom:'1px solid #d3dae1'}}>
                    {['Check','Result','Detail'].map(h => (
                      <th key={h} style={{padding:'6px 10px',textAlign:'left',fontSize:10,fontWeight:600,color:'#7b8894',textTransform:'uppercase'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(gd.checks || []).map((c, i) => {
                    const badge = RESULT_BADGE[c.result] || { bg:'#f3f5f7', color:'#4b5a68', label:c.result };
                    return (
                      <tr key={i} style={{borderBottom:'1px solid #f3f5f7',background:c.result==='FAIL'?'#fff8f8':c.result==='PHASE2'?'#faf5ff':'#fff'}}
                        data-testid={`gate-check-${i}`}>
                        <td style={{padding:'7px 10px',fontWeight:500}}>{c.chk}</td>
                        <td style={{padding:'7px 10px'}}>
                          <span style={{padding:'2px 8px',borderRadius:999,fontSize:10,fontWeight:700,background:badge.bg,color:badge.color}}>{badge.label}</span>
                        </td>
                        <td style={{padding:'7px 10px',color:'#4b5a68'}}>{c.detail}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div style={{background:'#f3f5f7',border:'1px dashed #d3dae1',borderRadius:8,padding:32,textAlign:'center',fontSize:12,color:'#7b8894'}}>
            Click "Run Gate Check" to validate all pre-flight conditions
          </div>
        )}

        {/* T-SQL plan */}
        {gd && (
          <div style={{marginTop:12,border:'1px solid #d3dae1',borderRadius:8,overflow:'hidden'}}>
            <button onClick={() => setShowTsql(!showTsql)}
              style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',background:'#f3f5f7',border:'none',cursor:'pointer',fontSize:11,color:'#4b5a68',fontFamily:'inherit'}}>
              <span>T-SQL Execution Plan — what the service will run</span>
              <span>{showTsql ? '▲' : '▼'}</span>
            </button>
            {showTsql && (
              <pre style={{margin:0,padding:'12px 14px',fontSize:11,fontFamily:'"IBM Plex Mono",monospace',background:'#0f151b',color:'#4ade80',overflowX:'auto',maxHeight:260,lineHeight:1.6}} className="rc-scrollbar">
                {buildTsqlPlan(ws)}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* Confirmation */}
      {gatePassed && (
        <div style={{...CARD, background:confirmed?'#dff3e5':'#fbeed3', border:`1px solid ${confirmed?'#1f7a3c44':'#a4620a44'}`}}>
          <label style={{display:'flex',alignItems:'flex-start',gap:10,cursor:'pointer'}}>
            <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}
              style={{accentColor:'#0f6e74',marginTop:3,flexShrink:0,width:17,height:17}}
              data-testid="confirm-import-checkbox" />
            <div>
              <p style={{fontSize:13,fontWeight:600,margin:'0 0 3px',color:confirmed?'#1f7a3c':'#a4620a'}}>
                I have reviewed the gate checklist and confirm I want to proceed with posting.
              </p>
              {validateData && (
                <p style={{fontSize:11,color:'#4b5a68',margin:0}}>
                  {(validateData.rowsValid + validateData.rowsWarn).toLocaleString('en-IN')} rows will be posted in chunks of {(config?.chunkSize || 50000).toLocaleString('en-IN')}.
                  Error rows ({validateData.rowsError}) will be skipped.
                </p>
              )}
            </div>
          </label>
        </div>
      )}

      <div style={{display:'flex',justifyContent:'space-between',paddingTop:4}}>
        <button onClick={() => patch({ step: ws.step - 1 })} style={BTN_OUTLINE}>← Back</button>
        <button onClick={() => patch({ step: ws.step + 1, maxStep: Math.max(ws.maxStep, ws.step + 1) })}
          disabled={!canProceed}
          style={{...BTN_PRIMARY, opacity:!canProceed?0.5:1, cursor:!canProceed?'not-allowed':'pointer'}}
          data-testid="wizard-gate-proceed-btn">
          {!gd ? 'Run gate check first' : !gatePassed ? 'Gate must pass first' : !confirmed ? 'Tick confirmation above' : 'Proceed to Import'}
        </button>
      </div>
    </div>
  );
}
