import { useNavigate } from 'react-router-dom';
import { WizardProvider, useWizard } from '@/components/wizard/WizardContext';
import Step1Source from '@/components/wizard/Step1Source';
import Step2Preview from '@/components/wizard/Step2Preview';
import Step3Mapping from '@/components/wizard/Step3Mapping';
import Step4Suppliers from '@/components/wizard/Step4Suppliers';
import Step5Masters from '@/components/wizard/Step5Masters';
import Step6Validation from '@/components/wizard/Step6Validation';
import Step7Confirm from '@/components/wizard/Step7Confirm';
import Step8Import from '@/components/wizard/Step8Import';
import Step9Result from '@/components/wizard/Step9Result';

const STEPS = [
  'Source','Preview','Mapping','Suppliers','Masters',
  'Validate','Confirm','Import','Result'
];

function WizardInner() {
  const { ws, patch } = useWizard();
  const navigate = useNavigate();

  const steps = [
    <Step1Source key="s1" />,
    <Step2Preview key="s2" />,
    <Step3Mapping key="s3" />,
    <Step4Suppliers key="s4" />,
    <Step5Masters key="s5" />,
    <Step6Validation key="s6" />,
    <Step7Confirm key="s7" />,
    <Step8Import key="s8" />,
    <Step9Result key="s9" onFinish={() => navigate('/dashboard')} />,
  ];

  const h = ws.apiHealth;
  const mssqlConfigured = h?.mssqlLive;
  const mssqlDb = h?.mssqlDb || h?.dbNew || 'RC26MASTERDB';

  return (
    <div style={{fontFamily:'"IBM Plex Sans",system-ui,sans-serif',minHeight:'100vh',background:'#f3f5f7',display:'flex',flexDirection:'column'}}>

      {/* ── Header ─────────────────────────────────────────────── */}
      <header style={{background:'#fff',borderBottom:'1px solid #d3dae1',position:'sticky',top:0,zIndex:30}}>
        <div style={{maxWidth:1280,margin:'0 auto',padding:'10px 16px',display:'flex',alignItems:'center',gap:14}}>
          <div style={{display:'flex',alignItems:'center',gap:10,flex:1,minWidth:0}}>
            <div style={{width:30,height:30,borderRadius:7,background:'#0f6e74',color:'#fff',display:'grid',placeItems:'center',fontWeight:700,fontSize:13,flexShrink:0}}>RC</div>
            <div style={{minWidth:0}}>
              <div style={{fontSize:15,fontWeight:600,whiteSpace:'nowrap'}}>RetailCLIQ Universal Import</div>
              <div style={{fontSize:11,color:'#7b8894',display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                Opening Stock Wizard ·
                <span style={{
                  display:'inline-flex',alignItems:'center',gap:4,padding:'2px 8px',borderRadius:999,
                  fontSize:10,fontWeight:600,
                  background:mssqlConfigured?'#dff3e5':'#fbeed3',
                  color:mssqlConfigured?'#1f7a3c':'#a4620a',
                }} data-testid="api-status-pill">
                  <span style={{width:5,height:5,borderRadius:'50%',background:'currentColor',flexShrink:0}}/>
                  {mssqlConfigured ? `MSSQL · ${mssqlDb}` : 'demo mode (MSSQL not configured)'}
                </span>
              </div>
            </div>
          </div>
          <a href="/dashboard" style={{
            display:'inline-flex',alignItems:'center',gap:5,padding:'6px 12px',
            border:'1px solid #d3dae1',borderRadius:6,fontSize:12,fontWeight:500,
            color:'#4b5a68',textDecoration:'none',background:'#fff',whiteSpace:'nowrap',flexShrink:0,
          }}>← Dashboard</a>
        </div>
      </header>

      {/* ── Stepper ────────────────────────────────────────────── */}
      <nav style={{background:'#fff',borderBottom:'1px solid #d3dae1',position:'sticky',top:51,zIndex:20}} data-testid="wizard-stepper">
        <div style={{maxWidth:1280,margin:'0 auto',padding:'10px 16px',overflowX:'auto'}}>
          <ol style={{display:'flex',listStyle:'none',margin:0,padding:0,minWidth:'max-content',gap:0}}>
            {STEPS.map((lbl,i)=>{
              const done=i<ws.step, cur=i===ws.step, can=i<=ws.maxStep;
              return (
                <li key={lbl} style={{display:'flex',alignItems:'center',flex:i<STEPS.length-1?'1 1 0':'0 0 auto'}}>
                  <button onClick={()=>can&&patch({step:i})} disabled={!can}
                    style={{display:'flex',alignItems:'center',gap:7,background:'none',border:0,
                      padding:'2px 4px',borderRadius:5,cursor:can?'pointer':'default',
                      color:cur?'#15202b':done?'#0f6e74':'#7b8894',fontWeight:cur?600:400,
                      fontSize:12,fontFamily:'inherit',opacity:can?1:0.5,whiteSpace:'nowrap'}}
                    data-testid={`step-nav-${i}`}>
                    <div style={{
                      width:25,height:25,borderRadius:'50%',flexShrink:0,
                      display:'grid',placeItems:'center',fontSize:11,fontWeight:700,
                      border:`2px solid ${done||cur?'#0f6e74':'#aab5c0'}`,
                      background:cur?'#0f6e74':done?'#dcf1f1':'#fff',
                      color:cur?'#fff':done?'#0f6e74':'#7b8894',transition:'all .15s',
                    }}>{done?'✓':i+1}</div>
                    <span>{lbl}</span>
                  </button>
                  {i<STEPS.length-1&&(
                    <div style={{flex:1,height:2,background:done?'#0f6e74':'#d3dae1',margin:'0 6px',borderRadius:1,minWidth:8,transition:'background .2s'}}/>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </nav>

      {/* ── Content ────────────────────────────────────────────── */}
      <main style={{flex:1,maxWidth:1280,margin:'0 auto',width:'100%',padding:'18px 16px 60px'}}>
        {ws.batchId&&(
          <div style={{marginBottom:12,fontSize:11,color:'#7b8894',display:'flex',alignItems:'center',gap:8}}>
            <span style={{fontFamily:'"IBM Plex Mono",monospace',background:'#e9edf1',padding:'2px 8px',borderRadius:4,border:'1px solid #d3dae1'}}>{ws.batchId}</span>
            <span>·</span>
            <span>Step {ws.step+1} of {STEPS.length} — {STEPS[ws.step]}</span>
          </div>
        )}
        {steps[ws.step]}
      </main>
    </div>
  );
}

export default function WizardPage() {
  return <WizardProvider><WizardInner /></WizardProvider>;
}
