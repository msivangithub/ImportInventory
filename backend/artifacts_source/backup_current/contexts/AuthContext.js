import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api, { fmtError } from '@/lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = loading, null = not authed

  useEffect(() => {
    const stored = localStorage.getItem('rc_user');
    if (stored) {
      try { setUser(JSON.parse(stored)); } catch { setUser(null); }
    } else {
      setUser(null);
    }
  }, []);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('rc_token', data.token);
    localStorage.setItem('rc_user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch {}
    localStorage.removeItem('rc_token');
    localStorage.removeItem('rc_user');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, fmtError }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
