import axios from 'axios';

const BASE = process.env.REACT_APP_BACKEND_URL;

const api = axios.create({ baseURL: `${BASE}/api` });

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('rc_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('rc_token');
      localStorage.removeItem('rc_user');
      if (!window.location.pathname.includes('/login')) window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export function fmtError(e) {
  const d = e?.response?.data?.detail;
  if (!d) return e?.message || 'An error occurred';
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map(x => x?.msg || JSON.stringify(x)).join(' ');
  return String(d);
}

export default api;
