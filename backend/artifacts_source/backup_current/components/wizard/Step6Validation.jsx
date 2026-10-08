import { useState, useCallback } from 'react';
import { useWizard } from './WizardContext';
import api, { fmtError } from '@/lib/api';
import { toast } from 'sonner';
import { resolveRow } from '@/lib/staging';

const CARD = { background:'#fff', border:'1px solid #d3dae1', borderRadius:10, boxShadow:'0 1px 3px rgba(21,32,43,.06)', padding:'18px 20px' };
const BTN_PRIMARY = { background:'#0f6e74', color:'#fff', border:'none', borderRadius:7, padding:'9px 20px', fontSize:13, fontWeight:600, cursor:'pointer' };
const BTN_OUTLINE = { background:'#fff', color:'#4b5a68', border:'1px solid #aab5c0', borderRadius:7, padding:'9px 16px', fontSize:13, fontWeight:500, cursor:'pointer' };
const BTN_TEAL = { background:'#0f6e74', color:'#fff', border:'none', borderRadius:6, padding:'7px 16px', fontSize:12, fontWeight:600, cursor:'pointer' };

const PROFILES = {
  generic:     { label:'Generic retail',          key:['OEMCode'],              dup:'ERROR' },
  apparel:     { label:'Apparel / Footwear',       key:['OEMCode','Size','Color'],dup:'ALLOW' },
  pharma:      { label:'Pharma (batch+expiry)',    key:['OEMCode','BatchNo'],    dup:'ERROR' },
  fmcg:        { label:'Grocery / FMCG',           key:['OEMCode','BatchNo'],    dup:'WARN'  },
  fresh:       { label:'Fresh produce',            key:['OEMCode','PackedDate'], dup:'ALLOW' },
  jewellery:   { label:'Jewellery',                key:['ItemCode'],             dup:'ERROR' },
  electronics: { label:'Electronics / serialised', key:['BatchNo'],             dup:'ERROR' },
};

const RULES = [
  'ItemDescription mandatory','UOMId blank → warning','Qty mandatory / numeric',
  'Qty cannot be negative','PurchasePrice mandatory / numeric','PurchasePrice cannot be negative',
  'MRP not numeric','TransDate invalid','ExpiryDate invalid','ExpiryDate before TransDate',
  'Supplier mandatory','Category mandatory','Tax mandatory','DisType must be P or A',
  'Taxtype must be I or E','InTaxtype must be I or E','PurchaseDiscountType must be P or A',
  'Supplier not in vendormaster','UOM not in UOMMaster','Tax not in Tax_Master',
  'Category not in CategoryMaster','Qty is zero → warning','PurchasePrice exceeds MRP → warning',
  'HSN (Verticle1) 4/6/8 digits → warning',
];

export default function Step6Validation() {
  const { ws, patch } = useWizard();
  const [loading, setLoading]     = useState(false);
  const [sending, setSending]     = useState(false);
  const [sendPct, setSendPct]     = useState(0);
  const [errData, setErrData]     = useState(null);
  const [errPage, setErrPage]     = useState(1);
  const [errFilter, setErrFilter] = useState('all');
  const [loadingErrs, setLoadingErrs] = useState(false);
  const [profile, setProfile]     = useState('generic');
  const [showRules, setShowRules] = useState(false);

  const { batchId, validateData, columns, rows: allRows, columnMapping, transforms, applyDefaults, suppliersData, masterMapData } = ws;

  const loadErrors = useCallback(async (page = 1, filter = 'all') => {
    setLoadingErrs(true);
    try {
      const { data } = await api.get(`/import/${batchId}/errors`, { params: { page, pageSize: 50, status_filter: filter } });
      setErrData(data); setErrPage(page);
    } catch (e) { toast.error(fmtError(e)); }
    finally { setLoadingErrs(false); }
  }, [batchId]);

  const runValidate = useCallback(async () => {
    if (!allRows?.length) { toast.error('No rows to validate — go back to Source and upload a file'); return; }
    setSending(true); setLoading(true); setSendPct(0);
    try {
      const suppRes  = suppliersData?.resolution  || {};
      const masterRes = masterMapData?.resolution || {};
      const resolved = allRows.map((row, idx) =>
        resolveRow(row, columns, columnMapping, transforms || {}, suppRes, masterRes, applyDefaults !== false, idx)
      );
      const BATCH = 5000;
      let nextRow = 1;
      for (let i = 0; i < resolved.length; i += BATCH) {
        const slice = resolved.slice(i, i + BATCH);
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
  }, [batchId, allRows, columns, columnMapping, transforms, applyDefaults, suppliersData, masterMapData, patch, loadErrors]);

  const changeFilter = (f) => { setErrFilter(f); loadErrors(1, f); };
  const vd = validateData;
  const prof = PROFILES[profile] || PROFILES.generic;

  const Tile = ({ v, l, color, bg }) => (
    <div style={{border:`1px solid ${bg}`,background:bg,borderRadius:8,padding:'10px 14px',textAlign:'center',borderLeft:`4px solid ${color}`}}>
      <div style={{fontSize:22,fontWeight:700,color,fontVariantNumeric:'tabular-nums'}}>{(v??0).toLocaleString('en-IN')}</div>
      <div style={{fontSize:11,color:'#7b8894',marginTop:2}}>{l}</div>
    </div>
  );

  return (
    <div style={{display:'flex',flexDirection:'column',gap:16}} data-testid="step-validate">
      <div style={CARD}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:10,marginBottom:14}}>
          <div>
            <h2 style={{fontSize:16,fontWeight:600,margin:'0 0 3px'}}>Validation</h2>
            <p style={{fontSize:12,color:'#7b8894',margin:0}}>Server-side validation with {RULES.length} rules · supplier + master resolutions applied</p>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
            <div style={{display:'flex',alignItems:'center',gap:6,fontSize:11}}>
              <span style={{color:'#4b5a68',whiteSpace:'nowrap'}}>Profile:</span>
              <select value={profile} onChange={e => setProfile(e.target.value)}
                style={{height:32,fontSize:11,border:'1px solid #d3dae1',borderRadius:5,background:'#fff',fontFamily:'inherit',padding:'0 6px',minWidth:180}}>
                {Object.entries(PROFILES).map(([k,p]) => <option key={k} value={k}>{p.label}</option>)}
              </select>
            </div>
            <button onClick={runValidate} disabled={loading || sending}
              style={{...BTN_TEAL, opacity:(loading||sending)?0.7:1, display:'flex', alignItems:'center', gap:6}}
              data-testid="wizard-run-validation-btn">
              {loading ? (sending ? `Sending… ${sendPct}%` : 'Validating…') : '▶ Run Validation'}
            </button>
          </div>
        </div>

        {/* Profile note */}
        <div style={{background:'#e0eafb',border:'1px solid #2457a844',borderRadius:7,padding:'8px 12px',marginBottom:14,fontSize:11,color:'#2457a8'}}>
          <strong>{prof.label}</strong> — dup key: <code style={{background:'#c8dcf8',borderRadius:3,padding:'0 4px'}}>{prof.key.join(' + ')}</code> · mode: {prof.dup}
        </div>

        {vd ? (
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:10}}>
            <Tile v={vd.totalRows} l="Total Rows" color="#15202b" bg="#f3f5f7" />
            <Tile v={vd.rowsValid} l="Valid"       color="#1f7a3c" bg="#dff3e5" />
            <Tile v={vd.rowsWarn}  l="Warnings"    color="#a4620a" bg="#fbeed3" />
            <Tile v={vd.rowsError} l="Errors"      color="#b42323" bg="#fbe1e1" />
          </div>
        ) : (
          <div style={{background:'#f3f5f7',border:'1px dashed #d3dae1',borderRadius:8,padding:32,textAlign:'center',fontSize:12,color:'#7b8894'}}>
            Click "Run Validation" to apply all resolutions and run {RULES.length} server-side rules
          </div>
        )}

        <button onClick={() => setShowRules(!showRules)}
          style={{background:'none',border:'none',cursor:'pointer',fontSize:11,color:'#7b8894',marginTop:10,padding:0}}>
          {showRules ? '▲ Hide' : '▼ Show'} {RULES.length} rules applied
        </button>
        {showRules && (
          <div style={{marginTop:8,display:'flex',flexWrap:'wrap',gap:6}}>
            {RULES.map((r, i) => (
              <span key={i} style={{fontSize:10,padding:'2px 8px',borderRadius:999,background:'#f3f5f7',border:'1px solid #d3dae1',color:'#4b5a68'}}>{i+1}. {r}</span>
            ))}
          </div>
        )}
      </div>

      {/* Error table */}
      {vd && (vd.rowsError > 0 || vd.rowsWarn > 0) && (
        <div style={CARD} data-testid="error-viewer-table">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8,marginBottom:12}}>
            <h3 style={{fontSize:13,fontWeight:600,margin:0}}>Validation Issues</h3>
            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
              <div style={{display:'flex',gap:4}}>
                {[['all','All'],['errors','Errors'],['warnings','Warnings']].map(([v,l]) => (
                  <button key={v} onClick={() => changeFilter(v)}
                    style={{padding:'2px 8px',borderRadius:4,border:`1px solid ${errFilter===v?'#0f6e74':'#d3dae1'}`,background:errFilter===v?'#0f6e74':'#fff',color:errFilter===v?'#fff':'#4b5a68',fontSize:11,cursor:'pointer'}}
                    data-testid={`error-filter-${v}`}>{l}</button>
                ))}
              </div>
              <a href={`${process.env.REACT_APP_BACKEND_URL}/api/import/${batchId}/errors/csv`}
                style={{fontSize:11,color:'#0f6e74',border:'1px solid #0f6e7444',borderRadius:4,padding:'2px 8px',textDecoration:'none'}}
                data-testid="error-export-csv-btn">↓ Download CSV</a>
            </div>
          </div>
          <div style={{overflowX:'auto',maxHeight:280}} className="rc-scrollbar">
            <table style={{borderCollapse:'collapse',width:'100%',minWidth:600,fontSize:11}}>
              <thead>
                <tr style={{background:'#f3f5f7',borderBottom:'1px solid #d3dae1'}}>
                  {['Row #','Type','Error / Warning','Description','Supplier','Category','Qty'].map(h => (
                    <th key={h} style={{padding:'6px 10px',textAlign:'left',fontSize:10,fontWeight:600,color:'#7b8894',textTransform:'uppercase',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loadingErrs
                  ? <tr><td colSpan={7} style={{padding:16,textAlign:'center',color:'#7b8894'}}>Loading…</td></tr>
                  : (errData?.rows || []).map(r => (
                    <tr key={r.rowNo} style={{borderBottom:'1px solid #f3f5f7'}} data-testid={`error-row-${r.rowNo}`}>
                      <td style={{padding:'6px 10px',fontFamily:'"IBM Plex Mono",monospace',fontWeight:500}}>{r.rowNo}</td>
                      <td style={{padding:'6px 10px'}}>
                        <span style={{padding:'1px 7px',borderRadius:999,fontSize:10,fontWeight:600,background:r.rowStatus==='E'?'#fbe1e1':'#fbeed3',color:r.rowStatus==='E'?'#b42323':'#a4620a'}}>
                          {r.rowStatus==='E'?'Error':'Warn'}
                        </span>
                      </td>
                      <td style={{padding:'6px 10px',maxWidth:260}}><div style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={r.errorMsg}>{r.errorMsg}</div></td>
                      <td style={{padding:'6px 10px',maxWidth:140,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.ItemDescription}</td>
                      <td style={{padding:'6px 10px',maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.Supplier}</td>
                      <td style={{padding:'6px 10px'}}>{r.Category}</td>
                      <td style={{padding:'6px 10px',fontFamily:'"IBM Plex Mono",monospace'}}>{r.Qty}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {errData && errData.pages > 1 && (
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:10,fontSize:11,color:'#7b8894'}}>
              <span>{errData.total} issues · page {errPage} of {errData.pages}</span>
              <div style={{display:'flex',gap:4}}>
                <button disabled={errPage<=1} onClick={() => loadErrors(errPage-1,errFilter)}
                  style={{padding:'2px 8px',border:'1px solid #d3dae1',borderRadius:4,cursor:'pointer',fontSize:11,background:'#fff',opacity:errPage<=1?0.5:1}}>Prev</button>
                <button disabled={errPage>=errData.pages} onClick={() => loadErrors(errPage+1,errFilter)}
                  style={{padding:'2px 8px',border:'1px solid #d3dae1',borderRadius:4,cursor:'pointer',fontSize:11,background:'#fff',opacity:errPage>=errData.pages?0.5:1}}>Next</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{display:'flex',justifyContent:'space-between',paddingTop:4}}>
        <button onClick={() => patch({ step: ws.step - 1 })} style={BTN_OUTLINE}>← Back</button>
        <button onClick={() => patch({ step: ws.step + 1, maxStep: Math.max(ws.maxStep, ws.step + 1) })} disabled={!vd}
          style={{...BTN_PRIMARY, opacity: !vd ? 0.5 : 1, cursor: !vd ? 'not-allowed' : 'pointer'}}
          data-testid="wizard-validate-next">
          Continue → Confirm
        </button>
      </div>
    </div>
  );
}
