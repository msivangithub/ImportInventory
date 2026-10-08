import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Database, Eye, EyeOff, AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const { login, fmtError } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!email || !password) { setError('Email and password are required'); return; }
    setLoading(true);
    setError('');
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(fmtError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Left panel */}
      <div className="hidden lg:flex w-1/2 bg-slate-900 flex-col justify-between p-12">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
            <Database className="w-5 h-5 text-white" />
          </div>
          <span className="text-white font-bold text-lg" style={{fontFamily:'Manrope,sans-serif'}}>RetailCLIQ Import</span>
        </div>
        <div>
          <h1 className="text-white text-4xl font-bold mb-4" style={{fontFamily:'Manrope,sans-serif'}}>
            Opening Stock<br />Migration Platform
          </h1>
          <p className="text-slate-400 text-sm leading-relaxed max-w-sm">
            Batch import manager for RetailCLIQ ERP. Validate every row against 24 rules, 
            post in resumable chunks, and roll back any batch — all from your browser.
          </p>
          <div className="mt-8 grid grid-cols-3 gap-4">
            {[['24', 'Validation Rules'],['Chunked','Resumable Posts'],['Full','Rollback Support']].map(([v,l]) => (
              <div key={l} className="bg-white/5 rounded-lg p-3">
                <div className="text-white font-bold text-lg">{v}</div>
                <div className="text-slate-400 text-xs mt-0.5">{l}</div>
              </div>
            ))}
          </div>
        </div>
        <p className="text-slate-600 text-xs">© 2026 RetailCLIQ India Pvt Ltd</p>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center">
              <Database className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-slate-900" style={{fontFamily:'Manrope,sans-serif'}}>RetailCLIQ Import</span>
          </div>

          <h2 className="text-2xl font-bold text-slate-900 mb-1" style={{fontFamily:'Manrope,sans-serif'}}>Sign in</h2>
          <p className="text-slate-500 text-sm mb-8">Enter your tenant credentials to continue</p>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="email" className="text-xs font-medium text-slate-700">Email address</Label>
              <Input id="email" type="email" autoComplete="email" autoFocus
                value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@retailcliq.com"
                className="mt-1 h-9 text-sm border-slate-200 focus:border-blue-500"
                data-testid="login-email-input" />
            </div>
            <div>
              <Label htmlFor="password" className="text-xs font-medium text-slate-700">Password</Label>
              <div className="relative mt-1">
                <Input id="password" type={showPw ? 'text' : 'password'} autoComplete="current-password"
                  value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-9 text-sm border-slate-200 focus:border-blue-500 pr-9"
                  data-testid="login-password-input" />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 transition-colors">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-md p-3" data-testid="login-error">
                <AlertCircle className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
                <p className="text-xs text-rose-700">{error}</p>
              </div>
            )}

            <Button type="submit" disabled={loading} className="w-full h-9 bg-slate-900 hover:bg-slate-800 text-white text-sm"
              data-testid="login-submit-button">
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <div className="mt-6 p-3 bg-blue-50 border border-blue-100 rounded-md">
            <p className="text-xs text-blue-700 font-medium mb-1">Demo credentials</p>
            <p className="text-xs text-blue-600 font-mono">msnarayana@retailcliq.com</p>
            <p className="text-xs text-blue-600 font-mono">RetailCLIQ@2026</p>
          </div>
        </div>
      </div>
    </div>
  );
}
