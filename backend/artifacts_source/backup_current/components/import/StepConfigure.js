import { useState } from 'react';
import api, { fmtError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import GlAccountSearch from '@/components/import/GlAccountSearch';
import { toast } from 'sonner';
import { Settings2, ChevronRight, Database, CircleDot } from 'lucide-react';

const FIELD = ({ label, children, hint, required }) => (
  <div>
    <Label className="text-xs font-medium text-slate-700">
      {label}{required && <span className="text-rose-500 ml-0.5">*</span>}
    </Label>
    {children}
    {hint && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
  </div>
);

const SEL = ({ value, onChange, options, testId }) => (
  <Select value={value} onValueChange={onChange}>
    <SelectTrigger className="h-9 mt-1 text-sm border-slate-200" data-testid={testId}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
    </SelectContent>
  </Select>
);

// Industry profile presets → auto-fill dupKeyColumns + dupMode
const PROFILES = {
  generic:     { dup: 'OEMCode',             mode: 'ERROR', label: 'Generic retail' },
  apparel:     { dup: 'OEMCode,Size,Color',  mode: 'ALLOW', label: 'Apparel / Footwear' },
  pharma:      { dup: 'OEMCode,BatchNo',     mode: 'ERROR', label: 'Pharma (batch+expiry)' },
  fmcg:        { dup: 'OEMCode,BatchNo',     mode: 'WARN',  label: 'Grocery / FMCG' },
  fresh:       { dup: 'OEMCode,PackedDate',  mode: 'ALLOW', label: 'Fresh produce' },
  jewellery:   { dup: 'ItemCode',            mode: 'ERROR', label: 'Jewellery' },
  electronics: { dup: 'BatchNo',             mode: 'ERROR', label: 'Electronics / serialised' },
};

export default function StepConfigure({ ws, patch }) {
  const [loading, setLoading] = useState(false);
  const cfg = ws.config;

  const set  = (k) => (v) => patch({ config: { ...cfg, [k]: v } });
  const setE = (k) => (e) => patch({ config: { ...cfg, [k]: e.target.value } });

  const applyProfile = (key) => {
    if (!key) return;
    const p = PROFILES[key];
    patch({ config: { ...cfg, dupKeyColumns: p.dup, dupMode: p.mode } });
    toast.success(`Profile "${p.label}" applied — dup key: ${p.dup}`);
  };

  const handleNext = async () => {
    if (!cfg.purchaseAccount?.trim()) { toast.error('Purchase Account (GL) is required'); return; }
    setLoading(true);
    try {
      const { data } = await api.post('/import/begin', {
        ...cfg, chunkSize: Number(cfg.chunkSize)
      });
      patch({ batchId: data.batchId, step: 1 });
      toast.success(`Batch ${data.batchId} created`);
    } catch (e) {
      toast.error(fmtError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-6" data-testid="step-configure">
      {/* Header */}
      <div className="flex items-center gap-2 mb-5">
        <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
          <Settings2 className="w-4 h-4 text-blue-600" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-900" style={{fontFamily:'Manrope,sans-serif'}}>Configure Import Batch</h2>
          <p className="text-xs text-slate-500">Opening Stock with Supplier — LEGACY mode</p>
        </div>
      </div>

      {/* Industry profile quick-apply */}
      <div className="mb-5 p-3 bg-slate-50 border border-slate-200 rounded-lg">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-medium text-slate-600 whitespace-nowrap">Industry profile:</span>
          {Object.entries(PROFILES).map(([key, p]) => (
            <button key={key} type="button"
              onClick={() => applyProfile(key)}
              className="px-2.5 py-1 rounded-full text-xs border border-slate-200 bg-white hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-colors"
              data-testid={`profile-${key}`}>
              {p.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-1.5">Quick-fills Duplicate Key Columns and Mode below</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {/* Import type */}
        <FIELD label="Import Type">
          <SEL value={cfg.importType} onChange={set('importType')}
            options={[['STOCK','Opening Stock (with Supplier)']]} testId="import-type-sel" />
        </FIELD>

        {/* Post mode */}
        <FIELD label="Post Mode">
          <SEL value={cfg.postMode} onChange={set('postMode')}
            options={[['LEGACY','LEGACY — proc_StockImportwithSupplier'],['NATIVE','NATIVE — set-based (Phase 2)']]}
            testId="post-mode-sel" />
        </FIELD>

        {/* Purchase Account — SearchInfo control */}
        <FIELD label="Purchase Account" required hint="M_GeneralLedger · CompId filtered · GlType='P'">
          <div className="mt-1" data-testid="purchase-account-input">
            <GlAccountSearch
              value={cfg.purchaseAccount}
              onSelect={(id) => patch({ config: { ...cfg, purchaseAccount: id } })}
              compId={ws.config?.compId}
            />
          </div>
        </FIELD>

        {/* Date order */}
        <FIELD label="Date Order" hint="Day/Month/Year order in your file">
          <SEL value={cfg.dateOrder} onChange={set('dateOrder')}
            options={[['DMY','DMY — 01/02/2026'],['MDY','MDY — 02/01/2026'],['YMD','YMD — 2026-02-01'],['HBS','HBS integer (e.g. 31711)']]}
            testId="date-order-sel" />
        </FIELD>

        {/* Number style */}
        <FIELD label="Number Style" hint="Decimal separator convention">
          <SEL value={cfg.numberStyle} onChange={set('numberStyle')}
            options={[['DOT','DOT — 1,234.56'],['COMMA','COMMA — 1.234,56']]}
            testId="number-style-sel" />
        </FIELD>

        {/* Region */}
        <FIELD label="Region / Formats">
          <SEL value={cfg.region} onChange={set('region')}
            options={[['en-IN','India (en-IN)'],['en-AE','UAE/GCC (en-AE)'],['en-GB','UK (en-GB)'],['en-US','USA (en-US)'],['de-DE','Germany (de-DE)'],['ar-SA','Saudi Arabia (ar-SA)']]}
            testId="region-sel" />
        </FIELD>

        {/* Duplicate key columns */}
        <FIELD label="Duplicate Key Columns" hint="Comma-separated field names that identify a unique line">
          <Input value={cfg.dupKeyColumns} onChange={setE('dupKeyColumns')} placeholder="OEMCode"
            className="mt-1 h-9 text-sm border-slate-200 font-mono" data-testid="dup-key-input" />
        </FIELD>

        {/* Duplicate mode */}
        <FIELD label="Duplicate Mode" hint="What to do when two rows share the same key">
          <SEL value={cfg.dupMode} onChange={set('dupMode')}
            options={[['ERROR','ERROR — reject duplicates'],['WARN','WARN — allow with warning'],['ALLOW','ALLOW — silent']]}
            testId="dup-mode-sel" />
        </FIELD>

        {/* DB mode */}
        <FIELD label="Target DB Mode" hint="FRESH = new empty DB (relaxed masters), RUNNING = live DB">
          <SEL value={cfg.dbMode} onChange={set('dbMode')}
            options={[['RUNNING','RUNNING — existing data'],['FRESH','FRESH — new / empty DB']]}
            testId="db-mode-sel" />
        </FIELD>

        {/* Chunk size */}
        <FIELD label="Chunk Size" hint="Rows per posting transaction (50,000 recommended)">
          <Input type="number" min={100} max={500000} value={cfg.chunkSize} onChange={setE('chunkSize')}
            className="mt-1 h-9 text-sm border-slate-200" data-testid="chunk-size-input" />
        </FIELD>

        {/* Remarks */}
        <div className="sm:col-span-2 lg:col-span-2">
          <FIELD label="Remarks (optional)">
            <Input value={cfg.remarks} onChange={setE('remarks')}
              placeholder="e.g. FY 2025-26 opening stock migration"
              className="mt-1 h-9 text-sm border-slate-200" data-testid="remarks-input" />
          </FIELD>
        </div>
      </div>

      {/* SQL Server status indicator */}
      <div className="mt-5 flex items-center gap-2 text-xs text-slate-400">
        <CircleDot className="w-3 h-3" />
        <span>Purchase Account searches <strong>M_GeneralLedger</strong> on the connected SQL Server (or demo data when MSSQL_SERVER is unset)</span>
      </div>

      <div className="mt-5 flex justify-end">
        <Button onClick={handleNext} disabled={loading}
          className="h-9 px-6 bg-slate-900 hover:bg-slate-800 text-white text-sm"
          data-testid="wizard-step-1-next">
          {loading ? 'Creating batch…' : 'Next — Upload File'}
          <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}
