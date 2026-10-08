import { useEffect } from 'react';
import { useWizard } from './WizardContext';
import { isHbsInt, hbsDisplay } from '@/lib/hbs';

const DATEISH = /date|dt$|expiry|exp|ason|mfg|dob|packed/i;
function detectType(vals, header) {
  const sample = vals.slice(0, 50).filter(v => v?.trim());
  if (!sample.length) return 'empty';
  if (DATEISH.test(header||'') && sample.every(v => isHbsInt(v))) return 'hbsdate';
  if (sample.every(v => !isNaN(parseFloat(v.replace(/,/g,''))))) return 'integer';
  if (DATEISH.test(header||'')) return 'date';
  return 'text';
}

export default function Step2Preview() {
  const { ws, patch, goNext } = useWizard();
  const { columns, rows, file, colStats, firstRowHeader } = ws;

  const colTypes = columns.map((col, i) =>
    detectType(rows.slice(0,50).map(r => r[i]||''), col)
  );
  const typeCounts = colTypes.reduce((a,t) => { a[t]=(a[t]||0)+1; return a; }, {});
  const previewRows = rows.slice(0, 10);

  // Build preview tiles
  const tiles = [
    { cls:'acc', v: file?.name || '—',                                     l:'File' },
    { cls:'info', v: columns.length,                                        l:'Columns detected' },
    { cls:'ok',  v: rows.length.toLocaleString('en-IN'),                    l:'Total records' },
    { cls:'n',   v: Object.entries(typeCounts).map(([t,n])=>`${n} ${t}`).join(', ') || '—', l:'Data types' },
  ];

  // nav
  useEffect(() => {
    patch({ nav: {
      backEnabled: true,
      nextEnabled: columns.length > 0,
      nextLabel: 'Continue →',
      statusText: columns.length > 0 ? `${columns.length} columns · ${rows.length.toLocaleString('en-IN')} records` : 'Load a file first',
    }});
  }, [columns.length, rows.length]); // eslint-disable-line

  if (!columns.length) return (
    <div className="wz-card" style={{ textAlign:'center', padding:40 }} data-testid="step-preview">
      <p className="muted">No file loaded — go back to Source and upload a file.</p>
    </div>
  );

  return (
    <div className="stack" data-testid="step-preview">
      {/* Panel head */}
      <div className="panel-head" style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, flexWrap:'wrap', marginBottom:14 }}>
        <div>
          <h2 style={{ fontSize:18, fontWeight:600 }}>Preview</h2>
          <p className="muted small">Check that columns and data types were read correctly before mapping.</p>
        </div>
        <div className="row">
          <label className="check small" style={{ display:'flex', gap:8, alignItems:'flex-start', cursor:'pointer' }}>
            <input type="checkbox" checked={firstRowHeader !== false}
              onChange={e => patch({ firstRowHeader: e.target.checked })}
              style={{ width:16, height:16, accentColor:'var(--wz-accent)', marginTop:2 }} />
            First row is header
          </label>
        </div>
      </div>

      {/* Summary tiles */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:10 }}>
        {tiles.map(t => (
          <div key={t.l} className={`wz-tile ${t.cls}`}>
            <div className="v" style={{ fontSize:t.l==='File'?14:24, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.v}</div>
            <div className="l">{t.l}</div>
          </div>
        ))}
      </div>

      {/* Column detection table */}
      <div className="wz-card">
        <div className="row" style={{ justifyContent:'space-between', marginBottom:10 }}>
          <h3>Column detection</h3>
          <span className="small muted" id="colCount">{columns.length} columns</span>
        </div>
        <div className="wz-tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th><th>Source column</th><th>Detected type</th>
                <th>Filled</th><th>Distinct</th><th>Sample values</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((col, i) => {
                const st = colStats[i] || {};
                const ty = colTypes[i];
                return (
                  <tr key={col}>
                    <td className="num">{i + 1}</td>
                    <td><b>{col}</b></td>
                    <td><span className="type-tag" style={{ fontFamily:'var(--wz-font-mono)', fontSize:11, color:'var(--wz-fg-3)' }}>{ty}</span></td>
                    <td className="num">{st.filled ?? 0}/{rows.length}</td>
                    <td className="num">{st.distinct ?? 0}</td>
                    <td style={{ color:'var(--wz-fg-3)', fontFamily:'var(--wz-font-mono)', fontSize:11 }}>
                      {ty === 'hbsdate' && st.samples?.[0]
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
      <div className="wz-card">
        <div className="row" style={{ justifyContent:'space-between', marginBottom:10 }}>
          <h3>Sample rows</h3>
          <span className="small muted">First {previewRows.length} of <b className="mono">{rows.length.toLocaleString('en-IN')}</b></span>
        </div>
        <div className="wz-tbl-wrap" style={{ maxHeight:280, overflowY:'auto' }}>
          <table>
            <thead>
              <tr>
                <th>#</th>
                {columns.map(c => <th key={c}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, ri) => (
                <tr key={ri}>
                  <td className="num">{ri + 1}</td>
                  {columns.map((c, ci) => {
                    const v = row[ci] || '';
                    const ty = colTypes[ci];
                    return (
                      <td key={ci} style={{ maxWidth:160, overflow:'hidden', textOverflow:'ellipsis' }}>
                        {ty === 'hbsdate' && v
                          ? <><span className="mono">{v}</span><span className="muted" style={{ marginLeft:4, fontSize:11 }}>→ {hbsDisplay(v)}</span></>
                          : v || <span className="muted">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
