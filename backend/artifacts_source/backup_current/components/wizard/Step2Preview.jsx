import { useWizard } from './WizardContext';
import { isHbsInt, hbsDisplay } from '@/lib/hbs';

const CARD = { background:'#fff', border:'1px solid #d3dae1', borderRadius:10, boxShadow:'0 1px 3px rgba(21,32,43,.06)', padding:'18px 20px' };
const BTN_PRIMARY = { background:'#0f6e74', color:'#fff', border:'none', borderRadius:7, padding:'9px 20px', fontSize:13, fontWeight:600, cursor:'pointer' };
const BTN_OUTLINE = { background:'#fff', color:'#4b5a68', border:'1px solid #aab5c0', borderRadius:7, padding:'9px 16px', fontSize:13, fontWeight:500, cursor:'pointer' };

const DATEISH = /date|dt$|expiry|exp|ason|mfg|dob|packed/i;

function detectType(vals, header) {
  const sample = vals.slice(0, 50).filter(v => v && v.trim());
  if (!sample.length) return 'empty';
  if (DATEISH.test(header || '') && sample.every(v => isHbsInt(v))) return 'hbsdate';
  if (sample.every(v => !isNaN(parseFloat(v.replace(/,/g, ''))))) return 'number';
  if (DATEISH.test(header || '')) return 'date';
  return 'text';
}

function TypeTag({ type }) {
  const colors = { number:'#a4620a', date:'#2457a8', hbsdate:'#2457a8', empty:'#7b8894', text:'#4b5a68' };
  return (
    <span style={{
      fontFamily:'"IBM Plex Mono",monospace', fontSize:10, padding:'1px 6px',
      borderRadius:4, background:'#f3f5f7', color: colors[type] || '#4b5a68',
    }}>{type}</span>
  );
}

function Tile({ value, label, color = '#2457a8' }) {
  const bgMap = { '#1f7a3c':'#dff3e5', '#2457a8':'#e0eafb', '#a4620a':'#fbeed3', '#0f6e74':'#dcf1f1' };
  return (
    <div style={{
      background: bgMap[color] || '#f3f5f7', border:'1px solid',
      borderColor: bgMap[color] ? color + '44' : '#d3dae1',
      borderRadius:8, padding:'10px 14px',
      borderLeftWidth:4, borderLeftColor: color,
    }}>
      <div style={{fontSize:22,fontWeight:700,fontVariantNumeric:'tabular-nums',lineHeight:1.1,color}}>{value}</div>
      <div style={{fontSize:11,color:'#7b8894',marginTop:2}}>{label}</div>
    </div>
  );
}

export default function Step2Preview() {
  const { ws, patch } = useWizard();
  const { columns, rows, colStats } = ws;

  if (!columns.length) {
    return (
      <div style={{...CARD, textAlign:'center', padding:40}}>
        <p style={{color:'#7b8894',fontSize:13}}>No file loaded — go back to Step 1 and upload a file.</p>
        <button onClick={() => patch({ step: 0 })} style={{...BTN_OUTLINE, marginTop:12}}>← Back to Source</button>
      </div>
    );
  }

  const previewRows = rows.slice(0, 10);
  const colTypes = columns.map((col, i) => detectType(rows.slice(0, 50).map(r => r[i] || ''), col));
  const typeCounts = colTypes.reduce((a, t) => { a[t] = (a[t] || 0) + 1; return a; }, {});

  return (
    <div style={{display:'flex',flexDirection:'column',gap:16}} data-testid="step-preview">

      {/* Summary tiles */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:10}}>
        <Tile value={ws.file?.name?.split('.').pop()?.toUpperCase() || '?'} label="Format" color="#0f6e74" />
        <Tile value={columns.length} label="Columns" color="#2457a8" />
        <Tile value={rows.length.toLocaleString('en-IN')} label="Data rows" color="#1f7a3c" />
        {Object.entries(typeCounts).map(([t, n]) => (
          <Tile key={t} value={n} label={`${t} col${n !== 1 ? 's' : ''}`} color="#a4620a" />
        ))}
      </div>

      {/* Column detection */}
      <div style={CARD}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <h3 style={{fontSize:13,fontWeight:600,margin:0}}>Column detection</h3>
          <span style={{fontSize:11,color:'#7b8894'}}>{columns.length} columns detected</span>
        </div>
        <div style={{overflowX:'auto'}} className="rc-scrollbar">
          <table style={{borderCollapse:'collapse',width:'100%',minWidth:600,fontSize:12}}>
            <thead>
              <tr style={{background:'#f3f5f7',borderBottom:'1px solid #d3dae1'}}>
                {['#','Source column','Detected type','Filled','Distinct','Sample values'].map(h => (
                  <th key={h} style={{padding:'7px 10px',textAlign:'left',fontSize:10,fontWeight:600,color:'#7b8894',textTransform:'uppercase',letterSpacing:'.05em',whiteSpace:'nowrap'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {columns.map((col, i) => {
                const st = colStats[i] || {};
                return (
                  <tr key={col} style={{borderBottom:'1px solid #f3f5f7'}}>
                    <td style={{padding:'6px 10px',color:'#7b8894',fontFamily:'"IBM Plex Mono",monospace'}}>{i + 1}</td>
                    <td style={{padding:'6px 10px',fontWeight:500}}>{col}</td>
                    <td style={{padding:'6px 10px'}}><TypeTag type={colTypes[i]} /></td>
                    <td style={{padding:'6px 10px',fontFamily:'"IBM Plex Mono",monospace',textAlign:'right'}}>{st.filled ?? 0}/{rows.length}</td>
                    <td style={{padding:'6px 10px',fontFamily:'"IBM Plex Mono",monospace',textAlign:'right'}}>{st.distinct ?? 0}</td>
                    <td style={{padding:'6px 10px',color:'#7b8894',fontFamily:'"IBM Plex Mono",monospace',fontSize:11}}>
                      {colTypes[i] === 'hbsdate' && st.samples?.[0]
                        ? `${st.samples[0]} → ${hbsDisplay(st.samples[0])}`
                        : (st.samples || []).join(' · ')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sample rows */}
      <div style={CARD}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <h3 style={{fontSize:13,fontWeight:600,margin:0}}>Sample rows</h3>
          <span style={{fontSize:11,color:'#7b8894'}}>First {previewRows.length} of {rows.length.toLocaleString('en-IN')}</span>
        </div>
        <div style={{overflowX:'auto',maxHeight:260}} className="rc-scrollbar">
          <table style={{borderCollapse:'collapse',fontSize:11,minWidth:600}}>
            <thead>
              <tr style={{background:'#f3f5f7',position:'sticky',top:0,borderBottom:'1px solid #d3dae1'}}>
                <th style={{padding:'6px 8px',color:'#7b8894',fontWeight:600,textAlign:'right',whiteSpace:'nowrap'}}>#</th>
                {columns.map(c => (
                  <th key={c} style={{padding:'6px 10px',color:'#7b8894',fontWeight:600,textAlign:'left',whiteSpace:'nowrap'}}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, ri) => (
                <tr key={ri} style={{borderBottom:'1px solid #f3f5f7'}}>
                  <td style={{padding:'5px 8px',color:'#aab5c0',fontFamily:'"IBM Plex Mono",monospace',textAlign:'right'}}>{ri + 1}</td>
                  {columns.map((c, ci) => {
                    const v = row[ci] || '';
                    const t = colTypes[ci];
                    return (
                      <td key={ci} style={{padding:'5px 10px',color:'#4b5a68',whiteSpace:'nowrap',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis'}}>
                        {t === 'hbsdate' && v
                          ? <span style={{fontFamily:'"IBM Plex Mono",monospace'}}>{v}<span style={{color:'#2457a8',marginLeft:4}}>→{hbsDisplay(v)}</span></span>
                          : v || <span style={{color:'#aab5c0'}}>—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Nav */}
      <div style={{display:'flex',justifyContent:'space-between',paddingTop:4}}>
        <button onClick={() => patch({ step: 0 })} style={BTN_OUTLINE}>← Back</button>
        <button onClick={() => patch({ step: 2, maxStep: Math.max(ws.maxStep, 2) })} style={BTN_PRIMARY}
          data-testid="preview-next-btn">
          Continue → Mapping
        </button>
      </div>
    </div>
  );
}
