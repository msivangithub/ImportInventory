import { useState, useCallback } from 'react';
import api, { fmtError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ResultBadge } from '@/components/batch/BatchStatusBadge';
import { toast } from 'sonner';
import { ShieldAlert, RefreshCw, ChevronRight, ChevronLeft, CheckCircle2, XCircle, Code2, ChevronDown } from 'lucide-react';

// Build a minimal T-SQL plan preview for the Confirm screen
function buildTsqlPlan(batch) {
  if (!batch) return '';
  return [
    `-- BatchId: ${batch.batchId || '?'}`,
    `-- ${batch.totalRows || 0} rows staged in Stock_Import_Export`,
    ``,
    `-- 1. Validate rows (set-based, 24 rules):`,
    `EXEC dbo.proc_Import_Validate @BatchId = '${batch.batchId || '?'}';`,
    ``,
    `-- 2. Final gate check:`,
    `EXEC dbo.proc_Import_Gate @BatchId = '${batch.batchId || '?'}', @AllowErrors = 0;`,
    ``,
    `-- 3. Post in chunks of ${batch.chunkSize || 50000} rows`,
    `--    Each chunk calls proc_StockImportwithSupplier inside XACT_ABORT ON:`,
    `EXEC dbo.proc_Import_Post @BatchId = '${batch.batchId || '?'}', @MaxChunks = 2;  -- loop until done`,
    ``,
    `-- 4. proc_StockImportwithSupplier signature:`,
    `EXEC dbo.proc_StockImportwithSupplier`,
    `  @CompId          = '${batch.compId || 'RCLQ01'}',`,
    `  @UserId          = '${batch.userId || 'U10001'}',`,
    `  @BranchId        = '${batch.branchId || 'BMS10001'}',`,
    `  @PurchaseAccount = '${batch.purchaseAccount || '24-HB0001'}',`,
    `  @MRNo            = @MRNo OUTPUT,`,
    `  @GSTXml          = '<GST>... 0% CGST/SGST/IGST (Phase 2 GST calc) ...</GST>';`,
    ``,
    `-- 5. Reconcile (row count + qty + value match):`,
    `EXEC dbo.proc_Import_Reconcile @BatchId = '${batch.batchId || '?'}';`,
    `-- On mismatch → Status = 'Failed'; on match → Status = 'Reconciled'`,
  ].join('\n');
}

export default function StepGate({ ws, patch }) {
  const [loading, setLoading] = useState(false);
  const [allowErrors, setAllowErrors] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [showTsql, setShowTsql] = useState(false);
  const { batchId, gateData } = ws;

  const runGate = useCallback(async () => {
    setLoading(true);
    setConfirmed(false);
    try {
      const { data } = await api.post(`/import/${batchId}/gate`, { allowErrors });
      patch({ gateData: data });
      if (data.gate?.gatePassed) toast.success('Gate passed — review the checklist and confirm to proceed');
      else toast.warning(`Gate has ${data.gate?.failures} failure(s). Review below.`);
    } catch (e) { toast.error(fmtError(e)); }
    finally { setLoading(false); }
  }, [batchId, allowErrors, patch]);

  const gd = gateData;
  const gatePassed = gd?.gate?.gatePassed;
  const canProceed = gatePassed && confirmed;

  return (
    <div className="space-y-4" data-testid="step-gate">
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm" data-testid="preflight-panel">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center">
              <ShieldAlert className="w-4 h-4 text-purple-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900" style={{fontFamily:'Manrope,sans-serif'}}>Pre-flight Gate</h2>
              <p className="text-xs text-slate-500">All checks must PASS before posting can begin</p>
            </div>
          </div>
          <Button onClick={runGate} disabled={loading} size="sm"
            className="h-9 px-4 bg-purple-600 hover:bg-purple-700 text-white text-sm"
            data-testid="preflight-recheck-btn">
            {loading ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Checking…</> : <><RefreshCw className="w-3.5 h-3.5 mr-1.5" />Run Gate Check</>}
          </Button>
        </div>

        {/* Allow errors option */}
        <div className="flex items-center gap-2 mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <Checkbox id="allow-errors" checked={allowErrors} onCheckedChange={setAllowErrors}
            data-testid="allow-errors-checkbox" />
          <Label htmlFor="allow-errors" className="text-xs text-amber-800 cursor-pointer">
            Allow error rows — they will be skipped during posting (valid + warning rows proceed)
          </Label>
        </div>

        {gd ? (
          <div className="space-y-2">
            {/* Summary badge */}
            <div className={`flex items-center gap-3 p-3 rounded-lg border ${gatePassed ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
              {gatePassed
                ? <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                : <XCircle className="w-5 h-5 text-rose-600" />}
              <div>
                <p className={`text-sm font-semibold ${gatePassed ? 'text-emerald-800' : 'text-rose-800'}`}>
                  {gatePassed ? 'Gate Passed — Ready to Post' : `Gate Failed — ${gd.gate.failures} issue(s) to resolve`}
                </p>
                {gd.gate.phase2Open > 0 && (
                  <p className="text-xs text-purple-700 mt-0.5">{gd.gate.phase2Open} Phase 2 items open (tracked, not blocking)</p>
                )}
              </div>
            </div>

            {/* Check list */}
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-xs border-collapse">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold text-slate-500 uppercase tracking-wide">Check</th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-500 uppercase tracking-wide w-24">Result</th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-500 uppercase tracking-wide">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {(gd.checks || []).map((c, i) => (
                    <tr key={i} className={`${c.result === 'FAIL' ? 'bg-rose-50/50' : c.result === 'PHASE2' ? 'bg-purple-50/50' : ''} hover:bg-slate-50`}
                      data-testid={`gate-check-${i}`}>
                      <td className="px-4 py-2 font-medium text-slate-700">{c.chk}</td>
                      <td className="px-4 py-2"><ResultBadge result={c.result} /></td>
                      <td className="px-4 py-2 text-slate-500">{c.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="bg-slate-50 border border-dashed border-slate-200 rounded-lg p-8 text-center text-sm text-slate-400">
            Click "Run Gate Check" to validate all pre-flight conditions
          </div>
        )}

        {/* T-SQL Execution Plan (expandable) */}
        {gd && (
          <div className="mt-4 border border-slate-200 rounded-lg overflow-hidden">
            <button onClick={() => setShowTsql(!showTsql)}
              className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors text-left">
              <span className="flex items-center gap-2 text-xs font-medium text-slate-600">
                <Code2 className="w-3.5 h-3.5 text-slate-400" />
                T-SQL Execution Plan <span className="text-slate-400 font-normal">— what the service will run</span>
              </span>
              <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showTsql ? 'rotate-180' : ''}`} />
            </button>
            {showTsql && (
              <pre className="px-4 py-3 text-xs font-mono text-slate-600 bg-slate-900 text-green-400 overflow-x-auto max-h-64 rc-scrollbar whitespace-pre-wrap leading-5">
                {buildTsqlPlan(ws.batchId ? { batchId: ws.batchId, ...ws.config } : null)}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* Confirmation checkbox (mirrors original Step 7 Confirm) */}
      {gatePassed && (
        <div className={`flex items-start gap-3 p-4 rounded-lg border transition-colors
          ${confirmed ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
          <Checkbox id="confirm-import" checked={confirmed} onCheckedChange={setConfirmed}
            className="mt-0.5" data-testid="confirm-import-checkbox" />
          <Label htmlFor="confirm-import" className="text-sm cursor-pointer leading-snug">
            <span className={`font-semibold ${confirmed ? 'text-emerald-800' : 'text-amber-800'}`}>
              I have reviewed the gate checklist above and confirm I want to proceed with posting.
            </span>
            <span className="block text-xs text-slate-500 mt-0.5">
              {ws.validateData
                ? `${ws.validateData.rowsValid + ws.validateData.rowsWarn} rows will be posted in chunks of ${ws.config?.chunkSize?.toLocaleString('en-IN')}. Error rows (${ws.validateData.rowsError}) will be skipped.`
                : 'Rows will be posted chunk by chunk with full rollback support.'}
            </span>
          </Label>
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <Button variant="outline" size="sm" onClick={() => patch({ step: 2 })} className="h-9 text-sm border-slate-200">
          <ChevronLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <Button onClick={() => patch({ step: 4 })} disabled={!canProceed}
          className="h-9 px-6 bg-slate-900 hover:bg-slate-800 text-white text-sm"
          data-testid="wizard-gate-proceed-btn">
          {!gd ? 'Run gate check first' : !gatePassed ? 'Gate must pass first' : !confirmed ? 'Tick confirmation above' : 'Proceed to Post'}
          <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}
