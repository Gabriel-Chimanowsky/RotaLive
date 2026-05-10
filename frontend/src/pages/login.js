import '../style.css';
import { api, setToken, isLoggedIn, getRole, clearToken, API_BASE } from '../api.js';

// Redirect if already logged in
if (isLoggedIn()) {
  const role = getRole();
  window.location.href = role === 'admin' ? '/src/pages/dashboard.html' : '/src/pages/motoboy.html';
}

// ─── Role tabs ────────────────────────────────────────────────────────────────
let selectedRole = 'admin';
document.querySelectorAll('.role-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.role-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    selectedRole = tab.dataset.role;

    // Prefill demo credentials based on role
    if (selectedRole === 'admin') {
      document.getElementById('email').value = 'admin@rotalive.com';
    } else {
      document.getElementById('email').value = 'motoboy@rotalive.com';
    }
  });
});

// ─── Password toggle ──────────────────────────────────────────────────────────
document.getElementById('toggle-pw').addEventListener('click', () => {
  const pw = document.getElementById('password');
  pw.type = pw.type === 'password' ? 'text' : 'password';
});

// ─── Login form ───────────────────────────────────────────────────────────────
const form = document.getElementById('login-form');
const alert = document.getElementById('login-alert');
const btn   = document.getElementById('login-btn');
const btnText = document.getElementById('login-text');
const spinner = document.getElementById('login-spinner');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  alert.classList.add('hidden');

  const email    = form.email.value.trim();
  const password = form.password.value;
  if (!email || !password) return;

  btn.disabled = true;
  btnText.textContent = 'Entrando...';
  spinner.classList.remove('hidden');

  try {
    // Use API_BASE instead of localhost
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: email, password }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Erro ao entrar');

    setToken(data.access_token, data.role, data.user_id, data.store_id);

    // Animate success before redirect
    btn.classList.remove('btn-primary');
    btn.classList.add('bg-neon-500', 'text-brand-950', 'rounded-xl', 'font-semibold');
    btnText.textContent = '✓ Sucesso!';

    setTimeout(() => {
      window.location.href = data.role === 'admin' ? '/src/pages/dashboard.html' : '/src/pages/motoboy.html';
    }, 600);

  } catch (err) {
    alert.textContent = 'O e-mail ou a senha estão errados. Tente novamente.';
    alert.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    spinner.classList.add('hidden');
    if (!btn.classList.contains('bg-neon-500')) {
      btnText.textContent = 'Entrar';
    }
  }
});

// Prefill demo admin by default
document.getElementById('email').value = 'admin@rotalive.com';
