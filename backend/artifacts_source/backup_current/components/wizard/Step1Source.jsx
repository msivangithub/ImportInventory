import { useState, useRef, useCallback } from 'react';
import { useWizard } from './WizardContext';
import api, { fmtError } from '@/lib/api';
import { toast } from 'sonner';
import { smartAutoMap, SAMPLE_STOCK, parseCSV } from '@/lib/staging';
import GlAccountSearch from '@/components/import/GlAccountSearch';

const CARD = { background:'#fff', border:'1px solid #d3dae1', borderRadius:10, boxShadow:'0 1px 3px rgba(21,32,43,.06)', padding:'18px 20px' };
const BTN_PRIMARY = { background:'#0f6e74', color:'#fff', border:'none', borderRadius:7, padding:'9px 20px', fontSize:13, fontWeight:600, cursor:'pointer', display:'inline-flex', alignItems:'center', gap:6 };
const BTN_OUTLINE = { background:'#fff', color:'#4b5a68', border:'1px solid #aab5c0', borderRadius:7, padding:'9px 16px', fontSize:13, fontWeight:500, cursor:'pointer' };

const PROFILES = {
  generic:     { dup:'OEMCode',            mode:'ERROR', label:'Generic' },
  apparel:     { dup:'OEMCode,Size,Color', mode:'ALLOW', label:'Apparel' },
  pharma:      { dup:'OEMCode,BatchNo',    mode:'ERROR', label:'Pharma' },
  fmcg:        { dup:'OEMCode,BatchNo',    mode:'WARN',  label:'Grocery/FMCG' },
  fresh:       { dup:'OEMCode,PackedDate', mode:'ALLOW', label:'Fresh produce' },
  jewellery:   { dup:'ItemCode',           mode:'ERROR', label:'Jewellery' },
  electronics: { dup:'BatchNo',            mode:'ERROR', label:'Electronics' },
};

function computeColStats(cols, rows) {
  return cols.map((col, i) => {
    const vals = rows.map(r => (r[i] || '').trim());
    const filled = vals.filter(v => v).length;
    const distinct = new Set(vals.filter(v => v)).size;
    const samples = [...new Set(vals.filter(v => v))].slice(0, 3);
    return { name: col, filled, distinct, samples };
  });
}

export default function Step1Source() {
  const { ws, patch } = useWizard();
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef();
  const cfg = ws.config;

  const setCfg = (k, v) => patch({ config: { ...cfg, [k]: v } });

  const loadParsedData = useCallback((cols, rows, name, size = 0) => {
    patch({
      file: { name, size },
      columns: cols,
      rows,
      colStats: computeColStats(cols, rows),
      columnMapping: smartAutoMap(cols),
      transforms: {},
      defaults: {},
    });
  }, [patch]);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx','xls','csv','tsv','txt'].includes(ext)) { toast.error('Please upload Excel (.xlsx) or CSV/TSV'); return; }
    setUploading(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const { data } = await api.post('/import/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      loadParsedData(data.columns, data.allRows || data.rows || [], data.name, data.size);
      toast.success(`Parsed ${(data.rowCount || 0).toLocaleString('en-IN')} rows`);
    } catch (e) {
      if (!['xlsx','xls'].includes(ext)) {
        const r = new FileReader();
        r.onload = () => {
          const { columns, rows } = parseCSV(String(r.result));
          loadParsedData(columns, rows, file.name, file.size);
          toast.info(`Parsed ${rows.length.toLocaleString('en-IN')} rows locally`);
        };
        r.readAsText(file);
      } else { toast.error(fmtError(e)); }
    } finally { setUploading(false); }
  }, [loadParsedData]);

  const loadSample = (e) => {
    e.stopPropagation();
    const { columns, rows } = parseCSV(SAMPLE_STOCK);
    loadParsedData(columns, rows, 'opening_stock_sample_FY2627.csv', SAMPLE_STOCK.length);
    toast.info('Sample loaded — 18 rows with deliberate errors for testing');
  };

  const handleNext = async () => {
    if (!ws.file) { toast.error('Please upload a file first'); return; }
    if (!cfg.purchaseAccount?.trim()) { toast.error('Purchase Account (GL) is required'); return; }
    setCreating(true);
    try {
      const { data } = await api.post('/import/begin', {
        ...cfg, dbMode: ws.dbMode, sourceName: ws.file.name, chunkSize: Number(cfg.chunkSize),
      });
      await api.post(`/import/${data.batchId}/source`, { sourceName: ws.file.name }).catch(() => {});
      patch({ batchId: data.batchId, step: 1, maxStep: 1 });
      toast.success(`Batch ${data.batchId} created`);
    } catch (e) { toast.error(fmtError(e)); }
    finally { setCreating(false); }
  };

  return (
    <div className="space-y-5" data-testid="step-source">

      {/* Source type */}
      <div style={CARD}>
        <h2 style={{fontSize:17,fontWeight:600,marginBottom:4}}>Where is the data coming from?</h2>
        <p style={{fontSize:12,color:'#7b8894',marginBottom:14}}>Pick a source. For files, drop a CSV or Excel export.</p>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          {[
            { id:'file', icon:'↑', label:'File upload',                    desc:'CSV, TSV, TXT or Excel (.xlsx). Max 50 MB.' },
            { id:'rc',   icon:'⇄', label:'RetailCLIQ → RetailCLIQ',        desc:'Pull opening stock from a running RetailCLIQ database.' },
          ].map(s => (
            <button key={s.id} type="button" onClick={() => patch({ source: s.id })}
              style={{
                textAlign:'left',borderRadius:10,border:`2px solid ${ws.source===s.id?'#0f6e74':'#d3dae1'}`,
                padding:14,background:ws.source===s.id?'#dcf1f1':'#fff',cursor:'pointer',transition:'all .15s',
              }}
              data-testid={`source-${s.id}`}>
              <div style={{width:30,height:30,borderRadius:7,background:ws.source===s.id?'#0f6e74':'#e9edf1',color:ws.source===s.id?'#fff':'#4b5a68',display:'grid',placeItems:'center',fontWeight:700,marginBottom:8}}>{s.icon}</div>
              <p style={{fontSize:13,fontWeight:600,marginBottom:3}}>{s.label}</p>
              <p style={{fontSize:11,color:'#7b8894',lineHeight:1.4}}>{s.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* File upload */}
      {ws.source === 'file' && (
        <div style={CARD}>
          <h3 style={{fontSize:13,fontWeight:600,marginBottom:12}}>Upload File</h3>
          {!ws.file ? (
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
              onClick={() => fileRef.current?.click()}
              style={{
                border:`2px dashed ${dragging?'#0f6e74':'#aab5c0'}`,borderRadius:10,padding:'32px 16px',
                textAlign:'center',cursor:'pointer',background:dragging?'#dcf1f1':'#f9fafb',transition:'all .15s',
              }}
              data-testid="file-drop-zone">
              <div style={{fontSize:32,marginBottom:8,color:'#aab5c0'}}>↑</div>
              <p style={{fontSize:13,fontWeight:500,color:'#4b5a68',margin:'0 0 4px'}}>
                Drop file here or <span style={{color:'#0f6e74',textDecoration:'underline'}}>browse</span>
              </p>
              <p style={{fontSize:11,color:'#7b8894',margin:'0 0 14px'}}>CSV, TSV, Excel (.xlsx) up to 50 MB · First row = header</p>
              <div style={{display:'flex',gap:10,justifyContent:'center',flexWrap:'wrap'}}>
                <label style={{...BTN_PRIMARY,cursor:'pointer'}} data-testid="choose-file-btn">
                  Choose file
                  <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.tsv,.txt"
                    style={{display:'none'}} onChange={e => handleFile(e.target.files[0])} />
                </label>
                <button type="button" onClick={loadSample} style={BTN_OUTLINE} data-testid="load-sample-btn">
                  Load sample file
                </button>
              </div>
            </div>
          ) : (
            <div style={{display:'flex',alignItems:'center',gap:12,border:'2px solid #0f6e74',borderRadius:10,padding:12,background:'#dcf1f1'}}>
              <span style={{fontSize:22}}>📄</span>
              <div style={{flex:1,minWidth:0}}>
                <p style={{fontSize:13,fontWeight:600,margin:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{ws.file.name}</p>
                <p style={{fontSize:11,color:'#4b5a68',margin:0}}>{ws.rows.length.toLocaleString('en-IN')} rows · {ws.columns.length} columns</p>
              </div>
              <button onClick={() => patch({ file:null,columns:[],rows:[],colStats:[],columnMapping:{},transforms:{} })}
                style={{background:'none',border:'none',cursor:'pointer',color:'#7b8894',fontSize:16,padding:4}}>✕</button>
            </div>
          )}
          {uploading && <p style={{fontSize:11,color:'#0f6e74',marginTop:8,textAlign:'center'}}>Parsing file…</p>}
        </div>
      )}

      {/* Target DB mode */}
      <div style={CARD}>
        <h3 style={{fontSize:13,fontWeight:600,marginBottom:4}}>Target database</h3>
        <p style={{fontSize:11,color:'#7b8894',marginBottom:12}}>Decides the default for every master value not found in RetailCLIQ.</p>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          {[
            { id:'RUNNING', label:'Running database',        desc:'Itemmaster already holds data — unmatched masters default to Existing.' },
            { id:'FRESH',   label:'Fresh / empty database',  desc:'New implementation — every master defaults to Create new.' },
          ].map(m => (
            <button key={m.id} type="button"
              onClick={() => patch({ dbMode: m.id, config: { ...cfg, dbMode: m.id } })}
              style={{
                textAlign:'left',borderRadius:8,border:`2px solid ${ws.dbMode===m.id?'#0f6e74':'#d3dae1'}`,
                padding:12,background:ws.dbMode===m.id?'#dcf1f1':'#fff',cursor:'pointer',transition:'all .15s',
              }}
              data-testid={`db-mode-${m.id.toLowerCase()}`}>
              <p style={{fontSize:13,fontWeight:600,margin:'0 0 3px'}}>{m.label}</p>
              <p style={{fontSize:11,color:'#7b8894',margin:0,lineHeight:1.4}}>{m.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Import settings */}
      <div style={CARD}>
        <h3 style={{fontSize:13,fontWeight:600,marginBottom:12}}>Import settings</h3>

        {/* Industry profile presets */}
        <div style={{background:'#f3f5f7',border:'1px solid #d3dae1',borderRadius:7,padding:'10px 12px',marginBottom:16}}>
          <p style={{fontSize:11,fontWeight:600,color:'#4b5a68',marginBottom:8}}>Industry profile (quick-fill dup key):</p>
          <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
            {Object.entries(PROFILES).map(([k,p]) => (
              <button key={k} type="button"
                onClick={() => patch({ config: { ...cfg, dupKeyColumns: p.dup, dupMode: p.mode } })}
                style={{padding:'3px 10px',borderRadius:999,fontSize:11,border:'1px solid #d3dae1',background:'#fff',cursor:'pointer',fontFamily:'inherit'}}
                data-testid={`profile-${k}`}>{p.label}</button>
            ))}
          </div>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:14}}>
          {/* Purchase Account */}
          <div>
            <label style={{fontSize:11,fontWeight:600,color:'#4b5a68',display:'block',marginBottom:4}}>
              Purchase Account <span style={{color:'#b42323'}}>*</span>
            </label>
            <GlAccountSearch value={cfg.purchaseAccount} onSelect={v => setCfg('purchaseAccount', v)} />
          </div>

          {/* Date Order */}
          <div>
            <label style={{fontSize:11,fontWeight:600,color:'#4b5a68',display:'block',marginBottom:4}}>Date Order</label>
            <select value={cfg.dateOrder} onChange={e => setCfg('dateOrder', e.target.value)}
              style={{width:'100%',height:36,padding:'0 10px',fontSize:12,border:'1px solid #aab5c0',borderRadius:6,background:'#fff',fontFamily:'inherit'}}
              data-testid="date-order-sel">
              <option value="DMY">DMY — 01/02/2026</option>
              <option value="MDY">MDY — 02/01/2026</option>
              <option value="YMD">YMD — 2026-02-01</option>
              <option value="HBS">HBS integer</option>
            </select>
          </div>

          {/* Number Style */}
          <div>
            <label style={{fontSize:11,fontWeight:600,color:'#4b5a68',display:'block',marginBottom:4}}>Number Style</label>
            <select value={cfg.numberStyle} onChange={e => setCfg('numberStyle', e.target.value)}
              style={{width:'100%',height:36,padding:'0 10px',fontSize:12,border:'1px solid #aab5c0',borderRadius:6,background:'#fff',fontFamily:'inherit'}}>
              <option value="DOT">DOT — 1,234.56</option>
              <option value="COMMA">COMMA — 1.234,56</option>
            </select>
          </div>

          {/* Region */}
          <div>
            <label style={{fontSize:11,fontWeight:600,color:'#4b5a68',display:'block',marginBottom:4}}>Region</label>
            <select value={cfg.region} onChange={e => setCfg('region', e.target.value)}
              style={{width:'100%',height:36,padding:'0 10px',fontSize:12,border:'1px solid #aab5c0',borderRadius:6,background:'#fff',fontFamily:'inherit'}}>
              <option value="en-IN">India (en-IN)</option>
              <option value="en-AE">UAE/GCC (en-AE)</option>
              <option value="en-GB">UK (en-GB)</option>
              <option value="en-US">USA (en-US)</option>
              <option value="de-DE">Germany (de-DE)</option>
              <option value="ar-SA">Saudi Arabia (ar-SA)</option>
            </select>
          </div>

          {/* Dup key */}
          <div>
            <label style={{fontSize:11,fontWeight:600,color:'#4b5a68',display:'block',marginBottom:4}}>Duplicate Key Columns</label>
            <input value={cfg.dupKeyColumns} onChange={e => setCfg('dupKeyColumns', e.target.value)}
              style={{width:'100%',height:36,padding:'0 10px',fontSize:12,border:'1px solid #aab5c0',borderRadius:6,fontFamily:'"IBM Plex Mono",monospace',boxSizing:'border-box'}}
              placeholder="OEMCode" data-testid="dup-key-input" />
          </div>

          {/* Dup mode */}
          <div>
            <label style={{fontSize:11,fontWeight:600,color:'#4b5a68',display:'block',marginBottom:4}}>Duplicate Mode</label>
            <select value={cfg.dupMode} onChange={e => setCfg('dupMode', e.target.value)}
              style={{width:'100%',height:36,padding:'0 10px',fontSize:12,border:'1px solid #aab5c0',borderRadius:6,background:'#fff',fontFamily:'inherit'}}>
              <option value="ERROR">ERROR — reject duplicates</option>
              <option value="WARN">WARN — allow with warning</option>
              <option value="ALLOW">ALLOW — silent</option>
            </select>
          </div>

          {/* Chunk size */}
          <div>
            <label style={{fontSize:11,fontWeight:600,color:'#4b5a68',display:'block',marginBottom:4}}>Chunk Size</label>
            <select value={cfg.chunkSize} onChange={e => setCfg('chunkSize', Number(e.target.value))}
              style={{width:'100%',height:36,padding:'0 10px',fontSize:12,border:'1px solid #aab5c0',borderRadius:6,background:'#fff',fontFamily:'inherit'}}>
              <option value={5000}>5,000</option>
              <option value={50000}>50,000 (recommended)</option>
              <option value={100000}>100,000</option>
            </select>
          </div>

          {/* Remarks */}
          <div style={{gridColumn:'span 2'}}>
            <label style={{fontSize:11,fontWeight:600,color:'#4b5a68',display:'block',marginBottom:4}}>Remarks (optional)</label>
            <input value={cfg.remarks} onChange={e => setCfg('remarks', e.target.value)}
              style={{width:'100%',height:36,padding:'0 10px',fontSize:12,border:'1px solid #aab5c0',borderRadius:6,fontFamily:'inherit',boxSizing:'border-box'}}
              placeholder="e.g. FY 2025-26 opening stock migration" />
          </div>
        </div>
      </div>

      {/* Nav */}
      <div style={{display:'flex',justifyContent:'flex-end',paddingTop:4}}>
        <button onClick={handleNext} disabled={creating || !ws.file}
          style={{...BTN_PRIMARY, opacity:(creating||!ws.file)?0.55:1, cursor:(creating||!ws.file)?'not-allowed':'pointer'}}
          data-testid="step1-next-btn">
          {creating ? 'Creating batch…' : 'Continue → Preview'}
        </button>
      </div>
    </div>
  );
}
