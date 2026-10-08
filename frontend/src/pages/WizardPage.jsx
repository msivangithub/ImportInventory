import { useNavigate } from 'react-router-dom';
import { WizardProvider, useWizard } from '@/components/wizard/WizardContext';
import { REGIONS, LANGUAGES, IMPORT_TYPES_LIST, BRANCHES } from '@/lib/wizard-constants';
import Step1Source     from '@/components/wizard/Step1Source';
import Step2Preview    from '@/components/wizard/Step2Preview';
import Step3Mapping    from '@/components/wizard/Step3Mapping';
import Step4Suppliers  from '@/components/wizard/Step4Suppliers';
import Step5Masters    from '@/components/wizard/Step5Masters';
import Step6Validation from '@/components/wizard/Step6Validation';
import Step7Confirm    from '@/components/wizard/Step7Confirm';
import Step8Import     from '@/components/wizard/Step8Import';
import Step9Result     from '@/components/wizard/Step9Result';

const STEP_NAMES = ["Source","Preview","Mapping","Suppliers","Master mapping","Validation","Confirm","Import","Result"];

function WizardInner() {
  const { ws, patch, goPrev, handleNext } = useWizard();
  const navigate = useNavigate();

  const h = ws.apiHealth;
  const mssqlOn = h?.mssqlLive;
  const mssqlDb = h?.mssqlDb || h?.dbNew || 'RC26MASTERDB';

  const region = REGIONS[ws.region] || REGIONS['en-IN'];

  const steps = [
    <Step1Source     key="s1" />,
    <Step2Preview    key="s2" />,
    <Step3Mapping    key="s3" />,
    <Step4Suppliers  key="s4" />,
    <Step5Masters    key="s5" />,
    <Step6Validation key="s6" />,
    <Step7Confirm    key="s7" />,
    <Step8Import     key="s8" />,
    <Step9Result     key="s9" onFinish={() => navigate('/dashboard')} />,
  ];

  return (
    <div className="wz-wrap">
      {/* ── Sticky Header ─────────────────────────────────────────── */}
      <header style={{ background:'var(--wz-surface)', borderBottom:'1px solid var(--wz-line)', position:'sticky', top:0, zIndex:30 }}>
        <div style={{ maxWidth:1280, margin:'0 auto', padding:'10px 16px', display:'flex', alignItems:'center', gap:14, flexWrap:'wrap' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, minWidth:0 }}>
            <div style={{ width:30, height:30, borderRadius:7, background:'var(--wz-accent)', color:'var(--wz-accent-fg)', display:'grid', placeItems:'center', fontWeight:700, fontSize:13, flexShrink:0 }}>RC</div>
            <div>
              <div style={{ fontSize:15, fontWeight:600, whiteSpace:'nowrap' }}>RetailCLIQ Universal Import</div>
              <div style={{ fontSize:11, color:'var(--wz-fg-3)', display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                One wizard for every master and transaction import ·
                <span className={`wz-pill ${mssqlOn ? 'acc' : 'n'}`} style={{ fontSize:10 }} data-testid="api-status-pill">
                  {mssqlOn ? `MSSQL · ${mssqlDb}` : 'demo mode'}
                </span>
              </div>
            </div>
          </div>

          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            {/* Import type */}
            <div className="wz-field">
              <label>Import type</label>
              <select className="wz-sel" value={ws.importType} onChange={e => patch({ importType: e.target.value })}
                style={{ minWidth:220 }} data-testid="header-import-type">
                {IMPORT_TYPES_LIST.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            {/* Branch context */}
            <div className="wz-field">
              <label>Branch context</label>
              <select className="wz-sel" value={ws.branchId} onChange={e => patch({ branchId: e.target.value })}
                style={{ minWidth:160 }} data-testid="header-branch">
                {BRANCHES.map(b => <option key={b.id} value={b.id}>{b.name} [{b.id}]</option>)}
              </select>
            </div>
            {/* Region */}
            <div className="wz-field">
              <label>Region / formats</label>
              <select className="wz-sel" value={ws.region}
                onChange={e => patch({ region: e.target.value, config: { ...ws.config, region: e.target.value } })}
                style={{ minWidth:160 }} data-testid="header-region">
                {Object.entries(REGIONS).map(([id, r]) => <option key={id} value={id}>{r.name}</option>)}
              </select>
            </div>
            {/* Language */}
            <div className="wz-field">
              <label>Language</label>
              <select className="wz-sel" value={ws.lang} onChange={e => patch({ lang: e.target.value })}
                style={{ minWidth:100 }} data-testid="header-lang">
                {LANGUAGES.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          </div>
        </div>
      </header>

      {/* ── Stepper ────────────────────────────────────────────────── */}
      <nav style={{ background:'var(--wz-surface)', borderBottom:'1px solid var(--wz-line)', position:'sticky', top:58, zIndex:20 }}
        aria-label="Import steps" data-testid="wizard-stepper">
        <div style={{ maxWidth:1280, margin:'0 auto', padding:'10px 16px', overflowX:'auto' }}>
          <ol className="wz-steps">
            {STEP_NAMES.map((name, i) => {
              const done = i < ws.step;
              const cur  = i === ws.step;
              const can  = i <= ws.maxStep;
              return (
                <li key={name} className={done ? 'done' : cur ? 'current' : ''}>
                  <button className="wz-step-btn" disabled={!can}
                    onClick={() => can && patch({ step: i })}
                    data-testid={`step-nav-${i}`}>
                    <span className="wz-dot">{done ? '✓' : i + 1}</span>
                    <span className="wz-step-lab">{name}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </nav>

      {/* ── Content ────────────────────────────────────────────────── */}
      <main style={{ flex:1, maxWidth:1280, margin:'0 auto', width:'100%', padding:'18px 16px 110px' }}>
        {ws.batchId && (
          <div style={{ marginBottom:12, fontSize:11, color:'var(--wz-fg-3)', display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontFamily:'var(--wz-font-mono)', background:'var(--wz-surface-2)', padding:'2px 8px', borderRadius:4, border:'1px solid var(--wz-line)' }}>{ws.batchId}</span>
            <span>·</span>
            <span>Step {ws.step + 1} of {STEP_NAMES.length} — {STEP_NAMES[ws.step]}</span>
          </div>
        )}
        {steps[ws.step]}
      </main>

      {/* ── Global sticky action bar ───────────────────────────────── */}
      <div className="wz-actions">
        <div className="wz-actions-in">
          <button className="wz-btn" onClick={goPrev}
            disabled={!ws.nav?.backEnabled || ws.step === 0}
            data-testid="wizard-back-btn">← Back</button>

          <div className="status" style={{ flex:1, minWidth:0, fontSize:12, color:'var(--wz-fg-2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {ws.nav?.statusText || ''}
          </div>

          <button className="wz-btn primary" onClick={handleNext}
            disabled={ws.nav?.nextEnabled === false}
            data-testid="wizard-next-btn">
            {ws.nav?.nextLabel || 'Continue →'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function WizardPage() {
  return <WizardProvider><WizardInner /></WizardProvider>;
}
