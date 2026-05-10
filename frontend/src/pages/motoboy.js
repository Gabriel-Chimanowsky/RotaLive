/* global L */
import '../style.css';
import { api, clearToken, getToken, getRole, isLoggedIn, WS_BASE, STATUS_LABELS, STATUS_BADGE, formatTime } from '../api.js';

if (!isLoggedIn() || !['motoboy', 'admin'].includes(getRole())) {
  clearToken();
  window.location.href = '/';
}

// ─── State ────────────────────────────────────────────────────────────────────
let deliveries = [];
let activeDelivery = null;
let motoboyMap = null;
let motoboyMarker = null;
let destMarker = null;
let routeLine = null;
let gpsWatchId = null;
let ws = null;
let currentLat = null;
let currentLng = null;
let storeData = null;

const ARRIVAL_RADIUS = 50; // metres

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180;
  const dl = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const [me, store] = await Promise.all([
      api.get('/api/users/me'),
      api.get('/api/stores/me')
    ]);
    storeData = store;
    document.documentElement.style.setProperty('--color-primary', store.primary_color);
    document.documentElement.style.setProperty('--color-secondary', store.secondary_color);
    document.getElementById('motoboy-name-header').textContent = me.name;
    await loadDeliveries();
  } catch {
    clearToken();
    window.location.href = '/';
  }
}

// ─── Load deliveries ──────────────────────────────────────────────────────────
async function loadDeliveries() {
  deliveries = await api.get('/api/deliveries');
  const inTransit = deliveries.find(d => d.status === 'in_transit');
  const arrived   = deliveries.find(d => d.status === 'arrived');

  if (inTransit) {
    setActiveDelivery(inTransit);
    return;
  }
  if (arrived) {
    setActiveDelivery(arrived);
    return;
  }

  // Show pending list
  document.getElementById('active-delivery-card').classList.add('hidden');
  document.getElementById('pending-list').classList.remove('hidden');
  renderPendingCards();
}

function renderPendingCards() {
  const container = document.getElementById('delivery-cards');
  const pending = deliveries.filter(d => d.status === 'pending');

  if (!pending.length) {
    document.getElementById('empty-state').classList.remove('hidden');
    document.getElementById('empty-state').classList.add('flex');
    container.innerHTML = '';
    return;
  }
  document.getElementById('empty-state').classList.add('hidden');

  container.innerHTML = pending.map(d => `
    <div class="glass-card rounded-2xl p-4 space-y-3 animate-fade-in">
      <div class="flex items-center justify-between">
        <div>
          <p class="font-semibold">${d.customer_name}</p>
          <p class="text-xs text-brand-400 mt-0.5">${d.customer_address}</p>
        </div>
        <span class="${STATUS_BADGE[d.status]}">${STATUS_LABELS[d.status]}</span>
      </div>
      <button onclick="startRoute('${d.id}')" class="btn-primary w-full py-4 text-base font-bold flex items-center justify-center gap-2">
        <span class="text-xl">🛵</span>
        Iniciar Rota
      </button>
    </div>
  `).join('');
}

window.startRoute = async (deliveryId) => {
  const d = deliveries.find(x => x.id === deliveryId);
  if (!d) return;
  await api.post(`/api/deliveries/${deliveryId}/dispatch`);
  d.status = 'in_transit';
  setActiveDelivery(d);
};

// ─── Active delivery UI ───────────────────────────────────────────────────────
function setActiveDelivery(d) {
  activeDelivery = d;
  document.getElementById('pending-list').classList.add('hidden');
  document.getElementById('empty-state').classList.add('hidden');

  const card = document.getElementById('active-delivery-card');
  card.classList.remove('hidden');

  document.getElementById('active-customer-name').textContent = d.customer_name;
  document.getElementById('active-address').textContent = d.customer_address || '—';

  // Show/hide address based on status
  if (d.status === 'completed' || d.status === 'cancelled') {
    document.getElementById('active-address-row').style.opacity = '0.3';
  }

  if (d.status === 'arrived') {
    document.getElementById('btn-arrive').classList.add('hidden');
    document.getElementById('btn-complete').classList.remove('hidden');
    document.getElementById('arrival-alert').classList.remove('hidden');
    document.getElementById('arrival-alert').classList.add('flex');
  }

  initMap(d);
  startGPS();
  connectWS(d.id);
}

// ─── Map ──────────────────────────────────────────────────────────────────────
function initMap(d) {
  if (!motoboyMap) {
    motoboyMap = L.map('motoboy-map', { zoomControl: false }).setView([d.dest_lat, d.dest_lng], 14);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO', maxZoom: 19,
    }).addTo(motoboyMap);
  }

  // Destination marker
  const destIcon = L.divIcon({
    className: '',
    html: `<div style="background:#6366f1;width:16px;height:16px;border-radius:50%;border:3px solid white;box-shadow:0 0 10px rgba(99,102,241,0.7)"></div>`,
    iconSize: [16, 16], iconAnchor: [8, 8],
  });
  if (destMarker) motoboyMap.removeLayer(destMarker);
  destMarker = L.marker([d.dest_lat, d.dest_lng], { icon: destIcon })
    .bindPopup(`<b>Destino</b><br>${d.customer_address}`)
    .addTo(motoboyMap);

  // Set initial motoboy position from last known
  if (d.last_lat && d.last_lng) updateMapPosition(d.last_lat, d.last_lng);
}

function updateMapPosition(lat, lng) {
  const icon = L.divIcon({
    className: '',
    html: `<div style="background:#10B981;width:18px;height:18px;border-radius:50%;border:3px solid white;box-shadow:0 0 12px rgba(16,185,129,0.8)"></div>`,
    iconSize: [18, 18], iconAnchor: [9, 9],
  });
  if (motoboyMarker) {
    motoboyMarker.setLatLng([lat, lng]);
  } else {
    motoboyMarker = L.marker([lat, lng], { icon }).addTo(motoboyMap);
  }
  motoboyMap.setView([lat, lng], 15);
}

// ─── GPS ──────────────────────────────────────────────────────────────────────
function startGPS() {
  if (!navigator.geolocation) {
    setGpsStatus('GPS não disponível', false);
    return;
  }
  setGpsStatus('Obtendo GPS...', false);
  gpsWatchId = navigator.geolocation.watchPosition(onGpsSuccess, onGpsError, {
    enableHighAccuracy: true, maximumAge: 5000, timeout: 15000,
  });
}

function stopGPS() {
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
  setGpsStatus('GPS inativo', false);
  document.getElementById('gps-indicator').classList.add('hidden');
}

function onGpsSuccess(pos) {
  currentLat = pos.coords.latitude;
  currentLng = pos.coords.longitude;
  setGpsStatus('GPS ativo', true);
  document.getElementById('gps-indicator').classList.remove('hidden');
  document.getElementById('gps-indicator').classList.add('flex');
  document.getElementById('gps-coords').textContent = `${currentLat.toFixed(5)}, ${currentLng.toFixed(5)}`;
  document.getElementById('gps-coords').classList.remove('hidden');

  updateMapPosition(currentLat, currentLng);

  // Send via WebSocket
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ lat: currentLat, lng: currentLng, accuracy: pos.coords.accuracy }));
  }

  // Local geofence check
  if (activeDelivery && activeDelivery.status === 'in_transit') {
    const dist = haversine(currentLat, currentLng, activeDelivery.dest_lat, activeDelivery.dest_lng);
    document.getElementById('dist-badge').classList.remove('hidden');
    document.getElementById('dist-badge').classList.add('flex');
    document.getElementById('dist-value').textContent = dist < 1000 ? `${Math.round(dist)}m` : `${(dist/1000).toFixed(1)}km`;

    if (dist <= ARRIVAL_RADIUS) {
      showArrivalAlert();
    }
  }
}

function onGpsError(err) {
  setGpsStatus('Erro de GPS: ' + err.message, false);
}

function setGpsStatus(text, active) {
  const dot = document.getElementById('gps-status-dot');
  document.getElementById('gps-status-text').textContent = text;
  dot.className = `w-2.5 h-2.5 rounded-full ${active ? 'bg-neon-500 animate-ping-slow' : 'bg-brand-500'}`;
}

// ─── WebSocket ────────────────────────────────────────────────────────────────
function connectWS(deliveryId) {
  if (ws) ws.close();
  const token = getToken();
  ws = new WebSocket(`${WS_BASE}/ws/motoboy/${deliveryId}?token=${token}`);
  ws.onopen = () => console.log('[WS] Motoboy connected');
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.event === 'arrival_geofence') showArrivalAlert();
  };
  ws.onclose = () => {
    // Reconnect after 3s if still active
    if (activeDelivery) setTimeout(() => connectWS(deliveryId), 3000);
  };
}

// ─── Arrival ─────────────────────────────────────────────────────────────────
function showArrivalAlert() {
  if (activeDelivery?.status !== 'in_transit') return;
  const alert = document.getElementById('arrival-alert');
  alert.classList.remove('hidden');
  alert.classList.add('flex');
  // Vibrate!
  if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
}

document.getElementById('btn-arrive').addEventListener('click', async () => {
  if (!activeDelivery) return;
  const btn = document.getElementById('btn-arrive');
  btn.disabled = true;
  try {
    await api.post(`/api/deliveries/${activeDelivery.id}/arrive`);
    activeDelivery.status = 'arrived';
    btn.classList.add('hidden');
    document.getElementById('btn-complete').classList.remove('hidden');
    showArrivalAlert();
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('btn-complete').addEventListener('click', async () => {
  if (!activeDelivery) return;
  if (storeData && storeData.require_delivery_code) {
    document.getElementById('delivery-code-input').value = '';
    document.getElementById('code-alert').classList.add('hidden');
    document.getElementById('modal-code').classList.remove('hidden');
    document.getElementById('modal-code').classList.add('flex');
    return;
  }
  await performCompleteDelivery();
});

document.getElementById('close-modal-code').addEventListener('click', () => {
  document.getElementById('modal-code').classList.add('hidden');
  document.getElementById('modal-code').classList.remove('flex');
});

document.getElementById('code-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = document.getElementById('delivery-code-input').value.trim();
  if (code.length !== 4) return;
  
  const btn = document.getElementById('code-submit');
  const spinner = document.getElementById('code-spinner');
  const btnText = document.getElementById('code-btn-text');
  const alert = document.getElementById('code-alert');
  
  btn.disabled = true; spinner.classList.remove('hidden'); btnText.textContent = '';
  alert.classList.add('hidden');
  
  try {
    await performCompleteDelivery(code);
    document.getElementById('modal-code').classList.add('hidden');
    document.getElementById('modal-code').classList.remove('flex');
  } catch (err) {
    alert.textContent = err.detail || 'Código inválido ou erro na conclusão';
    alert.classList.remove('hidden');
  } finally {
    btn.disabled = false; spinner.classList.add('hidden'); btnText.textContent = 'Confirmar Entrega';
  }
});

async function performCompleteDelivery(code = null) {
  const btn = document.getElementById('btn-complete');
  btn.disabled = true;
  try {
    await api.post(`/api/deliveries/${activeDelivery.id}/complete`, { code });
    stopGPS();
    if (ws) ws.close();
    activeDelivery = null;
    document.getElementById('active-delivery-card').classList.add('hidden');
    await loadDeliveries();
  } finally {
    btn.disabled = false;
  }
}

document.getElementById('btn-stop-route').addEventListener('click', () => {
  stopGPS();
  if (ws) { ws.close(); ws = null; }
  document.getElementById('active-delivery-card').classList.add('hidden');
  document.getElementById('pending-list').classList.remove('hidden');
  activeDelivery = null;
  loadDeliveries();
});

// ─── Refresh buttons ──────────────────────────────────────────────────────────
document.getElementById('refresh-mb')?.addEventListener('click', loadDeliveries);
document.getElementById('refresh-mb-list')?.addEventListener('click', loadDeliveries);

// ─── Logout ───────────────────────────────────────────────────────────────────
document.getElementById('logout-btn-mb').addEventListener('click', () => {
  stopGPS();
  clearToken();
  window.location.href = '/';
});

init();
