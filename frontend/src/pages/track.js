/* global L */
import '../style.css';
import { API_BASE, WS_BASE } from '../api.js';

// ─── Token from URL ────────────────────────────────────────────────────────────
const params = new URLSearchParams(window.location.search);
const token = params.get('token');

if (!token) {
  showError('Link de rastreamento inválido. Verifique a URL.');
}

// ─── State ────────────────────────────────────────────────────────────────────
let trackMap = null;
let motoboyMarker = null;
let destMarker = null;
let delivery = null;
let ws = null;
let originLat = null, originLng = null;
let totalDist = null;

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  try {
    const res = await fetch(`${API_BASE}/api/deliveries/track/${token}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showError(res.status === 410 ? 'Este link de rastreamento expirou.' : (err.detail || 'Link inválido.'));
      return;
    }
    delivery = await res.json();
    applyBranding(delivery);
    renderUI(delivery);
    initMap(delivery);
    connectWS();
    hideLoading();
  } catch (e) {
    showError('Não foi possível carregar o rastreamento. Tente novamente.');
  }
}

// ─── Branding ─────────────────────────────────────────────────────────────────
function applyBranding(d) {
  document.documentElement.style.setProperty('--color-primary', d.store_primary_color);
  document.documentElement.style.setProperty('--color-secondary', d.store_secondary_color);
  document.getElementById('track-body').style.background = d.store_primary_color + '0D'; // subtle tint

  // Header
  document.getElementById('store-name').textContent = d.store_name;

  if (d.store_logo) {
    const logoEl = document.getElementById('store-logo');
    logoEl.src = `${API_BASE}${d.store_logo}`;
    logoEl.classList.remove('hidden');
  } else {
    const fb = document.getElementById('store-logo-fallback');
    fb.textContent = d.store_name.charAt(0).toUpperCase();
    fb.style.background = d.store_secondary_color;
    fb.classList.remove('hidden');
  }

  // Title
  document.title = `Rastreio — ${d.store_name}`;

  // Apply secondary color to progress bar
  document.getElementById('progress-bar').style.background =
    `linear-gradient(to right, ${d.store_secondary_color}, ${d.store_secondary_color}cc)`;
}

// ─── Render UI ─────────────────────────────────────────────────────────────────
function renderUI(d) {
  // Status
  const statusMap = {
    pending:    { emoji: '⏳', label: 'Aguardando saída',  badge: 'badge-gray',   eta: 'Aguardando o motoboy...' },
    in_transit: { emoji: '🛵', label: 'A caminho!',        badge: 'badge-orange', eta: 'Calculando chegada...' },
    arrived:    { emoji: '📍', label: 'Chegou!',           badge: 'badge-green',  eta: 'Seu pedido está na porta!' },
    completed:  { emoji: '✅', label: 'Entrega concluída', badge: 'badge-green',  eta: 'Obrigado!' },
    cancelled:  { emoji: '❌', label: 'Cancelada',         badge: 'badge-red',    eta: 'Entrega cancelada.' },
  };
  const s = statusMap[d.status] || statusMap['in_transit'];
  document.getElementById('status-emoji').textContent = s.emoji;
  document.getElementById('status-label').textContent = s.label;
  document.getElementById('eta-text').textContent = s.eta;
  document.getElementById('status-badge').className = s.badge;
  document.getElementById('status-badge').textContent = s.label;

  // Motoboy
  if (d.motoboy_name) {
    document.getElementById('motoboy-name').textContent = d.motoboy_name;
    document.getElementById('motoboy-avatar').textContent = d.motoboy_name.charAt(0).toUpperCase();
  }

  if (d.status === 'arrived' || d.status === 'completed') {
    document.getElementById('arrived-bottom-badge').classList.remove('hidden');
    document.getElementById('live-dot').classList.add('hidden');
  }
}

// ─── Map ──────────────────────────────────────────────────────────────────────
function initMap(d) {
  const center = d.last_lat ? [d.last_lat, d.last_lng] : [d.dest_lat, d.dest_lng];

  trackMap = L.map('track-map', { zoomControl: false, attributionControl: false })
    .setView(center, 14);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
  }).addTo(trackMap);

  // Destination pin
  const destIcon = L.divIcon({
    className: '',
    html: `<div style="background:${d.store_secondary_color};width:18px;height:18px;border-radius:50%;border:3px solid white;box-shadow:0 0 12px ${d.store_secondary_color}aa"></div>`,
    iconSize: [18, 18], iconAnchor: [9, 9],
  });
  destMarker = L.marker([d.dest_lat, d.dest_lng], { icon: destIcon })
    .bindPopup('<b>Seu endereço</b>')
    .addTo(trackMap);

  // Motoboy marker (if position known)
  if (d.last_lat && d.last_lng) {
    updateMotoboyMarker(d.last_lat, d.last_lng, d);
    updateProgress(d.last_lat, d.last_lng, d);
  }
}

function updateMotoboyMarker(lat, lng, d) {
  const color = d?.store_secondary_color || '#10B981';
  const icon = L.divIcon({
    className: '',
    html: `
      <div style="position:relative;width:36px;height:36px">
        <div style="position:absolute;inset:0;background:${color}33;border-radius:50%;animation:ping 2s ease-in-out infinite"></div>
        <div style="position:absolute;inset:6px;background:${color};border-radius:50%;border:3px solid white;box-shadow:0 0 14px ${color}99"></div>
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:14px">🛵</div>
      </div>`,
    iconSize: [36, 36], iconAnchor: [18, 18],
  });

  if (motoboyMarker) {
    motoboyMarker.setLatLng([lat, lng]);
  } else {
    motoboyMarker = L.marker([lat, lng], { icon }).addTo(trackMap);
    trackMap.setView([lat, lng], 15);
  }
}

function updateProgress(lat, lng, d) {
  if (!d) return;
  const distToDest = haversine(lat, lng, d.dest_lat, d.dest_lng);

  // Set origin on first call
  if (!originLat) {
    originLat = lat; originLng = lng;
    totalDist = distToDest;
  }

  const pct = totalDist > 0 ? Math.max(0, Math.min(100, ((totalDist - distToDest) / totalDist) * 100)) : 0;
  document.getElementById('progress-bar').style.width = `${pct.toFixed(0)}%`;

  // ETA (rough: 30 km/h average)
  const speed = 30 * 1000 / 3600; // m/s
  const etaSec = distToDest / speed;
  const etaMin = Math.ceil(etaSec / 60);
  document.getElementById('eta-text').textContent = distToDest < 50
    ? 'Chegando agora! 📍'
    : `Estimativa: ~${etaMin} min`;

  document.getElementById('dist-label').textContent = distToDest < 1000
    ? `${Math.round(distToDest)}m`
    : `${(distToDest / 1000).toFixed(1)}km`;

  document.getElementById('last-update').textContent = 'Atualizado: ' + new Date().toLocaleTimeString('pt-BR');
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180;
  const dl = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ─── WebSocket ────────────────────────────────────────────────────────────────
function connectWS() {
  if (ws) ws.close();
  ws = new WebSocket(`${WS_BASE}/ws/track/${token}`);

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);

    if (msg.event === 'gps_update') {
      const { lat, lng } = msg;
      updateMotoboyMarker(lat, lng, delivery);
      updateProgress(lat, lng, delivery);
    }

    if (msg.event === 'arrived' || msg.event === 'arrival_geofence') {
      triggerArrivalCelebration();
    }

    if (msg.event === 'completed') {
      delivery.status = 'completed';
      renderUI(delivery);
    }

    if (msg.event === 'cancelled') {
      delivery.status = 'cancelled';
      renderUI(delivery);
    }
  };

  ws.onclose = () => {
    // Reconnect if delivery still active
    if (delivery && !['completed', 'cancelled'].includes(delivery.status)) {
      setTimeout(connectWS, 5000);
    }
  };
}

// ─── Arrival celebration ──────────────────────────────────────────────────────
function triggerArrivalCelebration() {
  // Update UI
  delivery.status = 'arrived';
  renderUI(delivery);

  // Show overlay
  const overlay = document.getElementById('arrived-overlay');
  overlay.classList.remove('hidden');
  overlay.classList.add('flex');

  // Vibrate
  if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 600]);

  // Play sound
  try {
    const audio = document.getElementById('arrival-sound');
    audio.volume = 0.5;
    audio.play().catch(() => {});
  } catch {}

  // Auto-hide overlay after 8s
  setTimeout(() => {
    overlay.classList.add('hidden');
    overlay.classList.remove('flex');
  }, 8000);
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function hideLoading() {
  document.getElementById('loading-screen').classList.add('hidden');
  document.getElementById('main-ui').classList.remove('hidden');
  document.getElementById('main-ui').classList.add('flex');
  // Invalidate map size after reveal
  setTimeout(() => trackMap?.invalidateSize(), 200);
}

function showError(msg) {
  document.getElementById('loading-screen').classList.add('hidden');
  const screen = document.getElementById('error-screen');
  screen.classList.remove('hidden');
  screen.classList.add('flex');
  document.getElementById('error-msg').textContent = msg;
}

// ─── Start ────────────────────────────────────────────────────────────────────
if (token) boot();
