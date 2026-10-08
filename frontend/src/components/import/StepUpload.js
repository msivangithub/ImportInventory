import { useState, useRef, useCallback } from 'react';
import api, { fmtError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  UploadCloud, FileSpreadsheet, ChevronRight, ChevronLeft,
  X, AlertTriangle, FlaskConical, Wand2
} from 'lucide-react';
import { isHbsInt, hbsDisplay } from '@/lib/hbs';
import {
  COLUMN_DEFS, REQUIRED, TRANSFORMS, STD_DEFAULTS,
  smartAutoMap, applyTransform, SAMPLE_STOCK, parseCSV
} from '@/lib/staging';

// Detect column type from sample values + header name
const DATEISH = /date|dt$|expiry|exp|ason|mfg|dob|packed/i;
function detectType(vals, header) {
  const sample = vals.slice(0, 50).filter(v => v && v.trim());
  if (!sample.length) return 'empty';
  if (DATEISH.test(header || '') && sample.every(v => isHbsInt(v))) return 'hbsdate';
  if (sample.every(v => !isNaN(parseFloat(v.replace(/,/g, ''))))) return 'number';
  return 'text';
}

export default function StepUpload({ ws, patch }) {
  const [uploading, setUploading] = useState(false);
  const [dragging,  setDragging]  = useState(false);
  const fileRef = useRef();

  const { uploadData, batchId } = ws;
  const { filename, columns, previewRows, allRows, rowCount, columnMapping, transforms, applyDefaults } = uploadData;

  // Update mapping in wizard state
  const setMap = (col, val) => patch({ uploadData: { ...uploadData, columnMapping: { ...columnMapping, [col]: val === '__skip__' ? '' : val } } });
  const setTr  = (col, val) => patch({ uploadData: { ...uploadData, transforms: { ...transforms, [col]: val === 'None' ? undefined : val } } });

  const loadData = useCallback((cols, rows, name) => {
    patch({
      uploadData: {
        ...uploadData, filename: name,
        columns: cols, previewRows: rows.slice(0, 20),
        allRows: rows, rowCount: rows.length,
        columnMapping: smartAutoMap(cols),
        transforms: {}, applyDefaults: true,
      }
    });
    toast.success(`Parsed ${rows.length.toLocaleString('en-IN')} rows`);
  }, [patch, uploadData]);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx','xls','csv','tsv','txt'].includes(ext)) { toast.error('Please upload Excel (.xlsx) or CSV/TSV'); return; }
    setUploading(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const { data } = await api.post('/import/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      loadData(data.columns, data.allRows || [], data.name);
    } catch (e) { toast.error(fmtError(e)); }
    finally { setUploading(false); }
  }, [loadData]);

  const loadSample = () => {
    const { columns: cols, rows } = parseCSV(SAMPLE_STOCK);
    loadData(cols, rows, 'opening_stock_sample_FY2627.csv');
    toast.info('Sample loaded — 18 rows, deliberate errors included for testing all 24 rules');
  };

  const onDrop = useCallback((e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }, [handleFile]);

  const missingRequired = REQUIRED.filter(r => !Object.values(columnMapping).includes(r));

  // NEXT — just advance step; rows are sent in StepValidate after all resolutions are built
  const handleNext = () => {
    if (!filename)               { toast.error('Please upload a file first'); return; }
    if (missingRequired.length)  { toast.error(`Map required columns: ${missingRequired.join(', ')}`); return; }
    api.post(`/import/${batchId}/source`, { sourceName: filename }).catch(() => {});
    patch({ step: ws.step + 1 });
  };

  const colTypes = columns.map((col, i) => detectType(previewRows.map(r => r[i] || ''), col));

  return (
    <div className="space-y-4" data-testid="step-upload">
      {/* Drop zone */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
        <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
              <UploadCloud className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900" style={{fontFamily:'Manrope,sans-serif'}}>Upload File</h2>
              <p className="text-xs text-slate-500">Excel (.xlsx) or CSV/TSV — first row = header</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={loadSample}
              className="h-8 text-xs border-slate-200 text-slate-600 hover:bg-amber-50 hover:border-amber-300"
              data-testid="load-sample-btn">
              <FlaskConical className="w-3.5 h-3.5 mr-1 text-amber-600" /> Load sample (18 rows)
            </Button>
            {filename && (
              <button onClick={() => patch({ uploadData: { ...uploadData, filename:null, columns:[], previewRows:[], allRows:[], rowCount:0, columnMapping:{}, transforms:{} } })}
                className="text-slate-400 hover:text-slate-600" data-testid="clear-file-btn">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {!filename ? (
          <div onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={onDrop}
            onClick={()=>fileRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-all ${dragging?'border-blue-400 bg-blue-50':'border-slate-200 hover:border-slate-400 hover:bg-slate-50'}`}
            data-testid="wizard-upload-dropzone">
            <UploadCloud className={`w-10 h-10 mx-auto mb-3 ${dragging?'text-blue-500':'text-slate-300'}`} />
            <p className="text-sm font-medium text-slate-600">Drop file here or <span className="text-blue-600">browse</span></p>
            <p className="text-xs text-slate-400 mt-1">CSV, TSV, Excel .xlsx up to 50 MB</p>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.tsv,.txt" className="hidden" onChange={e=>handleFile(e.target.files[0])} />
          </div>
        ) : (
          <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            <FileSpreadsheet className="w-8 h-8 text-emerald-600 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-slate-800">{filename}</p>
              <p className="text-xs text-slate-500">{rowCount.toLocaleString('en-IN')} rows · {columns.length} columns</p>
            </div>
          </div>
        )}
        {uploading && <p className="text-xs text-blue-600 mt-2 text-center animate-pulse">Parsing file…</p>}

        {/* Parse options */}
        <div className="mt-3 flex flex-wrap items-center gap-4 pt-3 border-t border-slate-100">
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <Checkbox checked={applyDefaults !== false} onCheckedChange={v => patch({ uploadData: { ...uploadData, applyDefaults: v } })} className="h-3.5 w-3.5" />
            <span className="text-slate-600">Apply standard defaults <span className="text-slate-400">(DisType=A, Taxtype=I, InTaxtype=E…)</span></span>
          </label>
        </div>
      </div>

      {/* Column mapping */}
      {columns.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">
              Column Mapping
              <span className="ml-2 text-xs font-normal text-slate-400">
                {Object.values(columnMapping).filter(Boolean).length} mapped
              </span>
            </h3>
            <div className="flex items-center gap-2">
              {missingRequired.length > 0 && (
                <div className="flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded border border-amber-200">
                  <AlertTriangle className="w-3 h-3 shrink-0" /> Missing: {missingRequired.join(', ')}
                </div>
              )}
              <Button type="button" variant="outline" size="sm"
                onClick={() => patch({ uploadData: { ...uploadData, columnMapping: smartAutoMap(columns), transforms: {} } })}
                className="h-7 text-xs border-slate-200">
                <Wand2 className="w-3 h-3 mr-1" /> Auto-map
              </Button>
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto rc-scrollbar">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-slate-50 sticky top-0 border-b border-slate-100">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold text-slate-500 uppercase tracking-wide">Your Column</th>
                  <th className="px-2 py-2 text-left font-semibold text-slate-400 uppercase tracking-wide text-xs w-20">Type</th>
                  <th className="px-4 py-2 text-left font-semibold text-slate-500 uppercase tracking-wide">Sample</th>
                  <th className="px-4 py-2 text-left font-semibold text-slate-500 uppercase tracking-wide w-52">→ Staging Field</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-500 uppercase tracking-wide w-44">Transform</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {columns.map((col, idx) => {
                  const mapped = columnMapping[col];
                  const isReq  = REQUIRED.includes(mapped);
                  const sample = previewRows.slice(0,3).map(r=>r[idx]||'').filter(Boolean).join(', ');
                  const typ    = colTypes[idx];
                  return (
                    <tr key={col} className={`${isReq?'bg-emerald-50/20':''} hover:bg-slate-50 transition-colors`}>
                      <td className="px-4 py-1.5 font-medium text-slate-700">{col}</td>
                      <td className="px-2 py-1.5">
                        <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${typ==='date'||typ==='hbsdate'?'bg-blue-50 text-blue-600':typ==='number'?'bg-amber-50 text-amber-700':'bg-slate-100 text-slate-500'}`}>
                          {typ}
                        </span>
                      </td>
                      <td className="px-4 py-1.5 text-slate-400 font-mono max-w-[160px] truncate">
                        {typ==='hbsdate'&&previewRows[0]?.[idx]
                          ? `${previewRows[0][idx]} → ${hbsDisplay(previewRows[0][idx])}`
                          : sample}
                      </td>
                      <td className="px-4 py-1.5 w-52">
                        <Select value={mapped||'__skip__'} onValueChange={v=>setMap(col,v)}>
                          <SelectTrigger className={`h-7 text-xs border-slate-200 ${isReq?'border-emerald-300':''}`}><SelectValue /></SelectTrigger>
                          <SelectContent className="max-h-56">
                            <SelectItem value="__skip__">(skip / ignore)</SelectItem>
                            {COLUMN_DEFS.map(f=>(
                              <SelectItem key={f.key} value={f.key}>{f.key}{f.req?' *':''}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-1.5 w-44">
                        {mapped ? (
                          <Select value={transforms?.[col]||'None'} onValueChange={v=>setTr(col,v)}>
                            <SelectTrigger className="h-7 text-xs border-slate-200 text-slate-500"><SelectValue /></SelectTrigger>
                            <SelectContent className="max-h-48">
                              {TRANSFORMS.map(t=><SelectItem key={t} value={t}>{t}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        ) : <span className="text-xs text-slate-300">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Preview table */}
      {previewRows.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">
              Preview <span className="text-xs font-normal text-slate-400 ml-1">first {previewRows.length} of {rowCount.toLocaleString('en-IN')} rows</span>
            </h3>
          </div>
          <div className="overflow-x-auto rc-scrollbar max-h-48">
            <table className="text-xs border-collapse">
              <thead className="bg-slate-50 border-b border-slate-100 sticky top-0">
                <tr>{columns.map((c,i)=>(
                  <th key={c} className="px-3 py-1.5 text-left font-semibold text-slate-500 whitespace-nowrap">
                    {c}{columnMapping[c]&&columnMapping[c]!==c&&<span className="ml-1 text-blue-400 font-normal text-xs">→{columnMapping[c]}</span>}
                  </th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {previewRows.map((row,ri)=>(
                  <tr key={ri} className="hover:bg-slate-50">
                    {columns.map((c,ci)=>{
                      const v = row[ci]||'';
                      const typ = colTypes[ci];
                      const tr = transforms?.[c];
                      const displayVal = tr && tr!=='None' ? applyTransform(v, tr) : v;
                      return (
                        <td key={ci} className="px-3 py-1 text-slate-600 whitespace-nowrap max-w-[200px] truncate">
                          {typ==='hbsdate'&&v
                            ? <span className="font-mono">{v}<span className="text-blue-500 ml-1">→{hbsDisplay(v)}</span></span>
                            : displayVal}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Nav */}
      <div className="flex items-center justify-between pt-1">
        <Button variant="outline" size="sm" onClick={() => patch({ step: ws.step - 1 })} className="h-9 text-sm border-slate-200">
          <ChevronLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <Button onClick={handleNext} disabled={!filename || missingRequired.length > 0}
          className="h-9 px-6 bg-slate-900 hover:bg-slate-800 text-white text-sm"
          data-testid="wizard-upload-next">
          Next — Suppliers <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}
