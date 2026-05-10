// API base URL — update this for production
export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';
export const WS_BASE = import.meta.env.VITE_WS_URL || 'ws://localhost:8000';

// ─── Token helpers ────────────────────────────────────────────────────────────

export function getToken() {
  return localStorage.getItem('rl_token');
}

export function setToken(token, role, userId, storeId) {
  localStorage.setItem('rl_token', token);
  localStorage.setItem('rl_role', role);
  localStorage.setItem('rl_user_id', userId);
  localStorage.setItem('rl_store_id', storeId);
}

export function clearToken() {
  ['rl_token', 'rl_role', 'rl_user_id', 'rl_store_id'].forEach(k => localStorage.removeItem(k));
}

export function getRole() {
  return localStorage.getItem('rl_role');
}

export function isLoggedIn() {
  return !!getToken();
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function request(method, path, body = null, raw = false) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${path}`, opts);

  if (res.status === 401) {
    clearToken();
    window.location.href = '/';
    return;
  }

  if (raw) return res;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { status: res.status, detail: data.detail || 'Erro desconhecido' };
  return data;
}

export const api = {
  get:    (path)         => request('GET',    path),
  post:   (path, body)   => request('POST',   path, body),
  patch:  (path, body)   => request('PATCH',  path, body),
  delete: (path)         => request('DELETE', path),
  raw:    (method, path, body) => request(method, path, body, true),
};

// ─── Status helpers ───────────────────────────────────────────────────────────

export const STATUS_LABELS = {
  pending:    'Pendente',
  in_transit: 'Em trânsito',
  arrived:    'Chegou',
  completed:  'Concluída',
  cancelled:  'Cancelada',
};

export const STATUS_BADGE = {
  pending:    'badge-gray',
  in_transit: 'badge-orange',
  arrived:    'badge-blue',
  completed:  'badge-green',
  cancelled:  'badge-red',
};

export function formatTime(isoStr) {
  if (!isoStr) return '—';
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(isoStr));
}

export function formatDate(isoStr) {
  if (!isoStr) return '—';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(isoStr));
}

// ─── Loading button helper ────────────────────────────────────────────────────

export function setLoading(btn, textEl, spinnerEl, loading, text = '') {
  btn.disabled = loading;
  textEl.textContent = loading ? '' : text;
  spinnerEl.classList.toggle('hidden', !loading);
}
