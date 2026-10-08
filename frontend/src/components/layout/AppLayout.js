import { useAuth } from '@/contexts/AuthContext';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { Database, LogOut, LayoutDashboard, PlusCircle, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function AppLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Sticky header */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-6 py-0 flex items-center justify-between h-14 shadow-sm">
        <div className="flex items-center gap-6">
          <Link to="/dashboard" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center">
              <Database className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-slate-900 text-sm tracking-tight" style={{fontFamily:'Manrope,sans-serif'}}>
              RetailCLIQ Import
            </span>
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            <Link to="/dashboard"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${location.pathname === '/dashboard' ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'}`}>
              <LayoutDashboard className="w-3.5 h-3.5" /> Dashboard
            </Link>
            <Link to="/import/new"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${location.pathname.startsWith('/import/new') ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'}`}>
              <PlusCircle className="w-3.5 h-3.5" /> New Import
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-4">
          {user && (
            <div className="hidden md:flex items-center gap-2 text-xs text-slate-500">
              <span className="font-medium text-slate-700">{user.compName}</span>
              <ChevronRight className="w-3 h-3" />
              <span>{user.branchName}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-semibold">
              {(user?.username || user?.email || 'U').charAt(0).toUpperCase()}
            </div>
            <span className="hidden sm:block text-xs font-medium text-slate-700">{user?.username || user?.email}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={handleLogout} className="text-slate-500 hover:text-slate-900 h-8 px-2" data-testid="logout-button">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
