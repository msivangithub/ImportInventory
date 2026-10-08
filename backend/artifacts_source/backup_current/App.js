import '@/App.css';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { Toaster } from '@/components/ui/sonner';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import WizardPage from '@/pages/WizardPage';
import BatchDetailPage from '@/pages/BatchDetailPage';

function ProtectedRoute({ children }) {
  const { user } = useAuth();
  if (user === undefined) {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-slate-500 text-sm">Loading...</div>
    </div>;
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<ProtectedRoute><Navigate to="/dashboard" replace /></ProtectedRoute>} />
      <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
      <Route path="/import/new" element={<ProtectedRoute><WizardPage /></ProtectedRoute>} />
      <Route path="/import/:batchId" element={<ProtectedRoute><BatchDetailPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
        <Toaster richColors position="top-right" />
      </BrowserRouter>
    </AuthProvider>
  );
}
