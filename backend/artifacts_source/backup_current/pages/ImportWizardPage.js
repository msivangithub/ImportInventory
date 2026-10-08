import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';
import StepConfigure from '@/components/import/StepConfigure';
import StepUpload from '@/components/import/StepUpload';
import StepSuppliers from '@/components/import/StepSuppliers';
import StepMasters from '@/components/import/StepMasters';
import StepValidate from '@/components/import/StepValidate';
import StepGate from '@/components/import/StepGate';
import StepPost from '@/components/import/StepPost';
import { CheckCircle2, ChevronRight } from 'lucide-react';

const STEPS = [
  { num: 1, title: 'Configure',      desc: 'Batch settings' },
  { num: 2, title: 'Upload',         desc: 'File & mapping' },
  { num: 3, title: 'Suppliers',      desc: 'Resolve vendors' },
  { num: 4, title: 'Master Mapping', desc: 'Match values' },
  { num: 5, title: 'Validate',       desc: '24 rules' },
  { num: 6, title: 'Gate',           desc: 'Pre-flight' },
  { num: 7, title: 'Post',           desc: 'Posting' },
];

const INIT = {
  step: 0,
  batchId: null,
  config: {
    importType: 'STOCK', postMode: 'LEGACY', purchaseAccount: '',
    dateOrder: 'DMY', numberStyle: 'DOT', region: 'en-IN',
    dupKeyColumns: 'OEMCode', dupMode: 'ERROR', dbMode: 'RUNNING',
    chunkSize: 50000, remarks: '',
  },
  uploadData: {
    filename: null, columns: [], previewRows: [], allRows: [], rowCount: 0,
    columnMapping: {}, transforms: {}, applyDefaults: true,
  },
  suppliersData: { mode: 'column', suppliers: [], singleName: '', singleExisting: '', resolution: {} },
  masterMapData:  { resolution: {}, masterMap: null, initialized: false },
  validateData: null,
  gateData: null,
};

export default function ImportWizardPage() {
  const navigate = useNavigate();
  const [ws, setWs] = useState(INIT);

  const patch = useCallback((updates) => setWs(prev => ({ ...prev, ...updates })), []);

  const stepComponents = [
    <StepConfigure key="cfg"  ws={ws} patch={patch} />,
    <StepUpload    key="upl"  ws={ws} patch={patch} />,
    <StepSuppliers key="sup"  ws={ws} patch={patch} />,
    <StepMasters   key="mas"  ws={ws} patch={patch} />,
    <StepValidate  key="val"  ws={ws} patch={patch} />,
    <StepGate      key="gate" ws={ws} patch={patch} />,
    <StepPost      key="post" ws={ws} patch={patch} onFinish={() => navigate('/dashboard')} />,
  ];

  return (
    <AppLayout>
      {/* Sticky stepper */}
      <div className="sticky top-14 z-20 bg-white border-b border-slate-200 shadow-sm" data-testid="wizard-stepper">
        <div className="max-w-screen-lg mx-auto px-6 py-3">
          <div className="flex items-start gap-0">
            {STEPS.map((s, i) => {
              const done   = i < ws.step;
              const active = i === ws.step;
              return (
                <div key={s.num} className="flex items-start flex-1">
                  <div className="flex flex-col items-center gap-1 min-w-0">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all
                      ${done   ? 'bg-emerald-500 border-emerald-500 text-white' :
                        active  ? 'bg-blue-600 border-blue-600 text-white' :
                                  'bg-white border-slate-300 text-slate-400'}`}>
                      {done ? <CheckCircle2 className="w-4 h-4" /> : s.num}
                    </div>
                    <div className="text-center hidden sm:block">
                      <div className={`text-xs font-semibold leading-none ${active ? 'text-slate-900' : done ? 'text-emerald-700' : 'text-slate-400'}`}>
                        {s.title}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">{s.desc}</div>
                    </div>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={`flex-1 h-0.5 mt-3.5 mx-1.5 ${i < ws.step ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Step content */}
      <div className="p-6 max-w-screen-lg mx-auto">
        {ws.batchId && (
          <div className="mb-4 flex items-center gap-2 text-xs text-slate-500">
            <span className="font-mono text-slate-700 bg-slate-100 px-2 py-0.5 rounded border">{ws.batchId}</span>
            <ChevronRight className="w-3 h-3" />
            <span>Step {ws.step + 1} of 7 — {STEPS[ws.step]?.title}</span>
          </div>
        )}
        {stepComponents[ws.step]}
      </div>
    </AppLayout>
  );
}
