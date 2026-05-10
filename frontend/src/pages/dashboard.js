/* global L */
import '../style.css';
import { api, clearToken, getToken, getRole, isLoggedIn, STATUS_LABELS, STATUS_BADGE, formatDate, formatTime } from '../api.js';

// Auth guard
if (!isLoggedIn() || getRole() !== 'admin') {
  clearToken();
  window.location.href = '/';
}

// ─── State ────────────────────────────────────────────────────────────────────
let currentPage = 'overview';
let overviewMap = null;
let mapMarkers = {};
let allDeliveries = [];
let motoboys = [];
let currentFilter = '';
let storeData = null;

// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function init() {
  try {
    const [me, store] = await Promise.all([
      api.get('/api/users/me'),
      api.get('/api/stores/me'),
    ]);
    storeData = store;
    document.getElementById('admin-name').textContent = me.name;
    document.getElementById('admin-avatar').textContent = me.name.charAt(0).toUpperCase();
    applyBranding(store);
    loadPage('overview');
  } catch (e) {
    clearToken();
    window.location.href = '/';
  }
}

function applyBranding(store) {
  document.documentElement.style.setProperty('--color-primary', store.primary_color);
  document.documentElement.style.setProperty('--color-secondary', store.secondary_color);

  const nameEl = document.getElementById('sidebar-brand-name');
  if (nameEl) nameEl.textContent = store.name;

  const logoEl = document.getElementById('sidebar-brand-logo');
  const defLogo = document.getElementById('sidebar-default-logo');
  if (logoEl && store.logo_path) {
    logoEl.src = `http://localhost:8000${store.logo_path}`;
    logoEl.classList.remove('hidden');
    defLogo.classList.add('hidden');
  } else if (logoEl) {
    logoEl.classList.add('hidden');
    defLogo.classList.remove('hidden');
  }
}

// ─── Navigation ───────────────────────────────────────────────────────────────
const pageTitles = {
  overview: 'Visão Geral',
  deliveries: 'Entregas',
  motoboys: 'Motoboys',
  whitelabel: 'White-Label',
  'new-delivery': 'Nova Entrega',
};

document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    const page = link.dataset.page;
    loadPage(page);
    // Close mobile sidebar
    document.getElementById('sidebar').classList.add('-translate-x-full');
  });
});

document.getElementById('sidebar-toggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('-translate-x-full');
});

document.getElementById('open-new-delivery').addEventListener('click', () => loadPage('new-delivery'));
document.getElementById('open-add-motoboy').addEventListener('click', () => {
  document.getElementById('modal-motoboy').classList.remove('hidden');
  document.getElementById('modal-motoboy').classList.add('flex');
});

function loadPage(page) {
  currentPage = page;
  document.querySelectorAll('[id^="page-"]').forEach(s => s.classList.add('hidden'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.remove('hidden');
  const navEl = document.getElementById(`nav-${page}`);
  if (navEl) navEl.classList.add('active');
  document.getElementById('page-title').textContent = pageTitles[page] || page;

  if (page === 'overview') loadOverview();
  if (page === 'deliveries') loadDeliveries();
  if (page === 'motoboys') loadMotoboys();
  if (page === 'whitelabel') loadWhiteLabel();
  if (page === 'new-delivery') loadNewDelivery();
}

// ─── OVERVIEW ─────────────────────────────────────────────────────────────────
async function loadOverview() {
  const [stats, deliveries] = await Promise.all([
    api.get('/api/deliveries/stats/summary'),
    api.get('/api/deliveries?status=in_transit'),
  ]);
  document.getElementById('stat-total').textContent = stats.total;
  document.getElementById('stat-active').textContent = stats.active;
  document.getElementById('stat-completed').textContent = stats.completed;
  document.getElementById('stat-pending').textContent = stats.pending;

  renderActiveList(deliveries);
  initOrUpdateMap(deliveries);
}

document.getElementById('refresh-overview').addEventListener('click', loadOverview);

function renderActiveList(deliveries) {
  const el = document.getElementById('active-deliveries-list');
  if (!deliveries.length) {
    el.innerHTML = '<p class="text-brand-500 text-sm text-center py-8">Nenhuma entrega ativa 🎉</p>';
    return;
  }
  el.innerHTML = deliveries.map(d => `
    <div class="glass-card-hover rounded-xl p-3 space-y-1" onclick="window.location.href='#'">
      <div class="flex items-center justify-between">
        <span class="font-medium text-sm truncate">${d.customer_name}</span>
        <span class="${STATUS_BADGE[d.status]}">${STATUS_LABELS[d.status]}</span>
      </div>
      <p class="text-xs text-brand-400 truncate">${d.customer_address}</p>
      <p class="text-xs text-brand-500">Saiu: ${formatTime(d.dispatched_at)}</p>
    </div>
  `).join('');
}

function initOrUpdateMap(deliveries) {
  const mapEl = document.getElementById('overview-map');
  if (!mapEl) return;

  if (!overviewMap) {
    overviewMap = L.map('overview-map', { zoomControl: true }).setView([-23.5505, -46.6333], 12);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO',
      maxZoom: 19,
    }).addTo(overviewMap);
  }

  // Clear old markers
  Object.values(mapMarkers).forEach(m => overviewMap.removeLayer(m));
  mapMarkers = {};

  deliveries.forEach(d => {
    if (d.last_lat && d.last_lng) {
      const icon = L.divIcon({
        className: '',
        html: `<div style="background:#10B981;width:14px;height:14px;border-radius:50%;border:3px solid white;box-shadow:0 0 8px rgba(16,185,129,0.7)"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      const marker = L.marker([d.last_lat, d.last_lng], { icon })
        .bindPopup(`<b>${d.customer_name}</b><br>${d.customer_address}`)
        .addTo(overviewMap);
      mapMarkers[d.id] = marker;
    }
  });
}

// ─── DELIVERIES ───────────────────────────────────────────────────────────────
async function loadDeliveries(status = currentFilter) {
  const url = status ? `/api/deliveries?status=${status}` : '/api/deliveries';
  const data = await api.get(url);
  allDeliveries = data;
  renderDeliveriesTable(data);
}

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active', 'bg-neon-500/20', 'text-neon-400'));
    btn.classList.add('active', 'bg-neon-500/20', 'text-neon-400');
    currentFilter = btn.dataset.status;
    loadDeliveries(currentFilter);
  });
});

function renderDeliveriesTable(deliveries) {
  const el = document.getElementById('deliveries-table');
  if (!deliveries.length) {
    el.innerHTML = '<p class="text-brand-500 text-sm text-center py-12">Nenhuma entrega encontrada</p>';
    return;
  }
  el.innerHTML = `
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead><tr class="border-b border-white/10 text-brand-400 text-xs uppercase tracking-wider">
          <th class="text-left px-4 py-3">Cliente</th>
          <th class="text-left px-4 py-3 hidden sm:table-cell">Endereço</th>
          <th class="text-left px-4 py-3">Status</th>
          <th class="text-left px-4 py-3 hidden md:table-cell">Criada</th>
          <th class="text-right px-4 py-3">Ações</th>
        </tr></thead>
        <tbody class="divide-y divide-white/5">
          ${deliveries.map(d => `
            <tr class="hover:bg-white/5 transition-colors">
              <td class="px-4 py-3 font-medium">${d.customer_name}</td>
              <td class="px-4 py-3 text-brand-400 hidden sm:table-cell truncate max-w-xs">${d.customer_address}</td>
              <td class="px-4 py-3"><span class="${STATUS_BADGE[d.status]}">${STATUS_LABELS[d.status]}</span></td>
              <td class="px-4 py-3 text-brand-500 hidden md:table-cell">${formatDate(d.created_at)}</td>
              <td class="px-4 py-3 text-right">
                ${d.status === 'pending' ? `<button onclick="dispatchDelivery('${d.id}')" class="btn-primary text-xs px-3 py-1.5">Despachar</button>` : ''}
                ${d.status === 'in_transit' ? `<button onclick="markArrived('${d.id}')" class="btn-ghost text-xs px-3 py-1.5">Chegou</button>` : ''}
                ${d.status === 'arrived' ? `<button onclick="completeDelivery('${d.id}')" class="bg-neon-500/20 text-neon-400 border border-neon-500/30 rounded-xl text-xs px-3 py-1.5">Concluir</button>` : ''}
                ${['pending','in_transit'].includes(d.status) ? `<button onclick="cancelDelivery('${d.id}')" class="btn-danger text-xs px-3 py-1.5 ml-2">✕</button>` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

window.dispatchDelivery = async (id) => {
  await api.post(`/api/deliveries/${id}/dispatch`);
  loadDeliveries();
};
window.markArrived = async (id) => {
  await api.post(`/api/deliveries/${id}/arrive`);
  loadDeliveries();
};
window.completeDelivery = async (id) => {
  await api.post(`/api/deliveries/${id}/complete`);
  loadDeliveries();
};
window.cancelDelivery = async (id) => {
  if (!confirm('Cancelar esta entrega?')) return;
  await api.post(`/api/deliveries/${id}/cancel`);
  loadDeliveries();
};

// ─── MOTOBOYS ─────────────────────────────────────────────────────────────────
async function loadMotoboys() {
  motoboys = await api.get('/api/users');
  const grid = document.getElementById('motoboys-grid');
  const motoboyList = motoboys.filter(u => u.role === 'motoboy');
  if (!motoboyList.length) {
    grid.innerHTML = '<p class="text-brand-500 text-sm col-span-3 text-center py-12">Nenhum motoboy cadastrado.</p>';
    return;
  }
  grid.innerHTML = motoboyList.map(u => `
    <div class="glass-card rounded-2xl p-4 space-y-3">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 bg-gradient-to-br from-brand-600 to-brand-800 rounded-xl flex items-center justify-center font-bold text-neon-400">
          ${u.name.charAt(0).toUpperCase()}
        </div>
        <div>
          <p class="font-medium text-sm">${u.name}</p>
          <p class="text-xs text-brand-400">${u.email}</p>
        </div>
      </div>
      <div class="flex items-center justify-between">
        <span class="${u.is_active ? 'badge-green' : 'badge-red'}">${u.is_active ? 'Ativo' : 'Inativo'}</span>
        ${u.is_active ? `<button onclick="deactivateMotoboy('${u.id}')" class="text-xs text-brand-500 hover:text-red-400 transition-colors">Desativar</button>` : ''}
      </div>
    </div>
  `).join('');
}

window.deactivateMotoboy = async (id) => {
  if (!confirm('Desativar este motoboy?')) return;
  await api.delete(`/api/users/${id}`);
  loadMotoboys();
};

// Add motoboy modal
document.getElementById('close-modal-motoboy').addEventListener('click', () => {
  document.getElementById('modal-motoboy').classList.add('hidden');
  document.getElementById('modal-motoboy').classList.remove('flex');
});

document.getElementById('add-motoboy-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const alert = document.getElementById('mb-alert');
  alert.classList.add('hidden');
  const btn = document.getElementById('mb-submit');
  const spinner = document.getElementById('mb-spinner');
  const btnText = document.getElementById('mb-btn-text');
  btn.disabled = true; spinner.classList.remove('hidden'); btnText.textContent = '';
  try {
    await api.post('/api/users', {
      name: document.getElementById('mb-name').value,
      email: document.getElementById('mb-email').value,
      phone: document.getElementById('mb-phone').value || null,
      password: document.getElementById('mb-password').value,
      role: 'motoboy',
    });
    document.getElementById('modal-motoboy').classList.add('hidden');
    document.getElementById('modal-motoboy').classList.remove('flex');
    document.getElementById('add-motoboy-form').reset();
    loadMotoboys();
  } catch (err) {
    alert.textContent = err.detail || 'Erro ao criar motoboy';
    alert.classList.remove('hidden');
  } finally {
    btn.disabled = false; spinner.classList.add('hidden'); btnText.textContent = 'Salvar Motoboy';
  }
});

// ─── WHITE-LABEL ──────────────────────────────────────────────────────────────
function loadWhiteLabel() {
  if (!storeData) return;
  document.getElementById('color-primary').value = storeData.primary_color;
  document.getElementById('color-primary-hex').value = storeData.primary_color;
  document.getElementById('color-secondary').value = storeData.secondary_color;
  document.getElementById('color-secondary-hex').value = storeData.secondary_color;
  document.getElementById('preview-store-name').textContent = storeData.name;
  if (document.getElementById('wl-require-code')) {
    document.getElementById('wl-require-code').checked = storeData.require_delivery_code ?? true;
  }
  const tpls = storeData.whatsapp_templates || {};
  document.getElementById('tpl-dispatched').value = tpls.dispatched || '';
  document.getElementById('tpl-arrived').value = tpls.arrived || '';
  if (storeData.logo_path) {
    const img = document.getElementById('logo-preview');
    img.src = `http://localhost:8000${storeData.logo_path}`;
    img.classList.remove('hidden');
    document.getElementById('logo-placeholder').classList.add('hidden');
  }
  loadWhatsAppStatus();
}

async function loadWhatsAppStatus() {
  const statusContainer = document.getElementById('wa-status-container');
  const qrImg = document.getElementById('wa-qr-img');
  const overlay = document.getElementById('wa-qr-overlay');
  const placeholder = document.getElementById('wa-qr-placeholder');
  const disconnectBtn = document.getElementById('wa-disconnect-btn');

  try {
    const res = await api.get('/api/whatsapp/instance');
    if (res.state === 'connected') {
      statusContainer.innerHTML = '<span class="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></span> Conectado';
      overlay.classList.add('hidden');
      qrImg.classList.add('hidden');
      placeholder.classList.remove('hidden');
      placeholder.classList.replace('text-brand-300', 'text-green-500');
      disconnectBtn.classList.remove('hidden');
    } else {
      statusContainer.innerHTML = '<span class="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]"></span> Desconectado';
      disconnectBtn.classList.add('hidden');
      placeholder.classList.replace('text-green-500', 'text-brand-300');
      if (res.qr) {
        // base64 já pode vir formatada ou não, mas a evolution v2 manda como base64 raw as vezes
        qrImg.src = res.qr.startsWith('data:') ? res.qr : `data:image/png;base64,${res.qr}`;
        qrImg.classList.remove('hidden');
        placeholder.classList.add('hidden');
        overlay.classList.add('hidden');
        
        // Polling para quando o usuário escanear
        setTimeout(loadWhatsAppStatus, 5000);
      } else {
        qrImg.classList.add('hidden');
        placeholder.classList.remove('hidden');
        overlay.classList.remove('hidden');
      }
    }
  } catch (err) {
    statusContainer.innerHTML = '<span class="w-2 h-2 rounded-full bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.8)]"></span> API Offline ou Iniciando...';
  }
}

document.getElementById('wa-gen-btn').addEventListener('click', async () => {
  const btn = document.getElementById('wa-gen-btn');
  btn.textContent = 'Conectando...';
  await loadWhatsAppStatus();
  btn.textContent = 'Gerar QR Code';
});

document.getElementById('wa-disconnect-btn').addEventListener('click', async () => {
  if (!confirm('Tem certeza que deseja desconectar o seu WhatsApp?')) return;
  document.getElementById('wa-disconnect-btn').textContent = 'Desconectando...';
  try {
    await api.delete('/api/whatsapp/instance');
  } catch (e) {}
  document.getElementById('wa-disconnect-btn').textContent = 'Desconectar WhatsApp';
  await loadWhatsAppStatus();
});

// Color sync
['primary', 'secondary'].forEach(type => {
  const picker = document.getElementById(`color-${type}`);
  const hex = document.getElementById(`color-${type}-hex`);
  picker.addEventListener('input', () => {
    hex.value = picker.value;
    document.documentElement.style.setProperty(`--color-${type}`, picker.value);
    document.getElementById('wl-preview').style.background = document.getElementById('color-primary').value;
  });
  hex.addEventListener('input', () => {
    if (/^#[0-9A-Fa-f]{6}$/.test(hex.value)) {
      picker.value = hex.value;
      document.documentElement.style.setProperty(`--color-${type}`, hex.value);
    }
  });
});

// Logo upload
document.getElementById('logo-drop').addEventListener('click', () => document.getElementById('logo-input').click());
document.getElementById('logo-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = document.getElementById('logo-preview');
    img.src = ev.target.result;
    img.classList.remove('hidden');
    document.getElementById('logo-placeholder').classList.add('hidden');
    document.getElementById('preview-logo').src = ev.target.result;
    document.getElementById('preview-logo').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
  document.getElementById('upload-logo-btn').classList.remove('hidden');
});

document.getElementById('upload-logo-btn').addEventListener('click', async () => {
  const file = document.getElementById('logo-input').files[0];
  if (!file) return;
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('http://localhost:8000/api/stores/me/logo', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${getToken()}` },
    body: form,
  });
  if (res.ok) {
    storeData = await res.json();
    document.getElementById('upload-logo-btn').classList.add('hidden');
  }
});

document.getElementById('save-whitelabel-btn').addEventListener('click', async () => {
  const msg = document.getElementById('wl-save-msg');
  const spinner = document.getElementById('wl-spinner');
  msg.classList.add('hidden');
  spinner.classList.remove('hidden');
  try {
    storeData = await api.patch('/api/stores/me', {
      primary_color: document.getElementById('color-primary').value,
      secondary_color: document.getElementById('color-secondary').value,
      require_delivery_code: document.getElementById('wl-require-code').checked,
      whatsapp_templates: {
        dispatched: document.getElementById('tpl-dispatched').value,
        arrived: document.getElementById('tpl-arrived').value,
      },
    });
    applyBranding(storeData);
    msg.classList.remove('hidden');
    setTimeout(() => msg.classList.add('hidden'), 3000);
  } catch (err) {
    alert('Erro ao salvar: ' + (err.detail || err));
  } finally {
    spinner.classList.add('hidden');
  }
});

let ndMap = null;
let ndMarker = null;

async function loadNewDelivery() {
  const users = await api.get('/api/users');
  motoboys = users.filter(u => u.role === 'motoboy' && u.is_active);
  const sel = document.getElementById('nd-motoboy');
  sel.innerHTML = '<option value="">Selecionar motoboy...</option>' +
    motoboys.map(m => `<option value="${m.id}">${m.name}</option>`).join('');

  if (!ndMap) {
    ndMap = L.map('nd-map').setView([-23.5505, -46.6333], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO', maxZoom: 19
    }).addTo(ndMap);
    
    ndMarker = L.marker([-23.5505, -46.6333], {
      draggable: true,
      icon: L.divIcon({
        className: '',
        html: `<div style="background:#10B981;width:18px;height:18px;border-radius:50%;border:3px solid white;box-shadow:0 0 12px rgba(16,185,129,0.8)"></div>`,
        iconSize: [18, 18], iconAnchor: [9, 9]
      })
    }).addTo(ndMap);
    
    // Set default hidden values
    document.getElementById('nd-lat').value = -23.5505;
    document.getElementById('nd-lng').value = -46.6333;
    
    ndMarker.on('dragend', function () {
      document.getElementById('nd-lat').value = ndMarker.getLatLng().lat;
      document.getElementById('nd-lng').value = ndMarker.getLatLng().lng;
    });
  }
  
  // Re-calculate size when unhidden
  setTimeout(() => ndMap.invalidateSize(), 300);
}

document.getElementById('new-delivery-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const alertEl = document.getElementById('nd-alert');
  const successEl = document.getElementById('nd-success');
  alertEl.classList.add('hidden');
  successEl.classList.add('hidden');
  const btn = document.getElementById('nd-submit');
  const spinner = document.getElementById('nd-spinner');
  const btnText = document.getElementById('nd-btn-text');
  btn.disabled = true; spinner.classList.remove('hidden'); btnText.textContent = '';
  
  // Format Address
  const street = document.getElementById('nd-street').value.trim();
  const num = document.getElementById('nd-number').value.trim();
  const comp = document.getElementById('nd-complement').value.trim();
  const neigh = document.getElementById('nd-neighborhood').value.trim();
  const citySt = document.getElementById('nd-city-state').value.trim();
  const cep = document.getElementById('nd-cep').value.trim();
  
  const fullAddress = `${street}, ${num}${comp ? ' - ' + comp : ''} - ${neigh}, ${citySt} - CEP: ${cep}`;

  try {
    const d = await api.post('/api/deliveries', {
      customer_name: document.getElementById('nd-name').value,
      customer_phone: document.getElementById('nd-phone').value,
      customer_address: fullAddress,
      dest_lat: parseFloat(document.getElementById('nd-lat').value),
      dest_lng: parseFloat(document.getElementById('nd-lng').value),
      motoboy_id: document.getElementById('nd-motoboy').value || null,
    });
    const trackUrl = `${window.location.origin}/src/pages/track.html?token=${d.tracking_token}`;
    successEl.innerHTML = `✓ Entrega criada!<br>Código PIN (Senha): <span class="text-white font-bold">${d.delivery_code || 'N/A'}</span><br><span class="font-mono text-xs">${trackUrl}</span>`;
    successEl.classList.remove('hidden');
    document.getElementById('new-delivery-form').reset();
  } catch (err) {
    alertEl.textContent = err.detail || 'Erro ao criar entrega';
    alertEl.classList.remove('hidden');
  } finally {
    btn.disabled = false; spinner.classList.add('hidden'); btnText.textContent = 'Criar Entrega';
  }
});

// ─── ViaCEP Integration ───────────────────────────────────────────────────────
const cepInput = document.getElementById('nd-cep');
if (cepInput) {
  cepInput.addEventListener('input', async (e) => {
    let cep = e.target.value.replace(/\D/g, '');
    const status = document.getElementById('cep-status');
    
    // Auto-format CEP
    if (cep.length > 5) cep = cep.replace(/^(\d{5})(\d)/, '$1-$2');
    e.target.value = cep;

    const rawCep = cep.replace(/\D/g, '');
    if (rawCep.length === 8) {
      status.textContent = 'Buscando CEP...';
      status.className = 'text-xs text-brand-400 mb-3 animate-pulse';
      try {
        const res = await fetch(`https://viacep.com.br/ws/${rawCep}/json/`);
        const data = await res.json();
        if (data.erro) throw new Error();
        
        document.getElementById('nd-street').value = data.logradouro || '';
        document.getElementById('nd-neighborhood').value = data.bairro || '';
        document.getElementById('nd-city-state').value = `${data.localidade}/${data.uf}`;
        
        status.textContent = '✓ CEP encontrado';
        status.className = 'text-xs text-neon-400 mb-3';
        document.getElementById('nd-number').focus();

        // Geocode to map
        const fullAddrStr = `${data.logradouro}, ${data.localidade}, ${data.uf}, Brasil`;
        try {
          const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(fullAddrStr)}`);
          const geoData = await geoRes.json();
          if (geoData && geoData.length > 0) {
            const lat = parseFloat(geoData[0].lat);
            const lng = parseFloat(geoData[0].lon);
            document.getElementById('nd-lat').value = lat;
            document.getElementById('nd-lng').value = lng;
            if (ndMap && ndMarker) {
              ndMap.setView([lat, lng], 16);
              ndMarker.setLatLng([lat, lng]);
            }
          }
        } catch(e){}
        
      } catch {
        status.textContent = 'CEP não encontrado. Digite manualmente.';
        status.className = 'text-xs text-orange-400 mb-3';
      }
    } else {
      status.textContent = 'Digite o CEP...';
      status.className = 'text-xs text-brand-500 mb-3';
    }
  });
}

// ─── Logout ───────────────────────────────────────────────────────────────────
document.getElementById('logout-btn').addEventListener('click', () => {
  clearToken();
  window.location.href = '/';
});

// Auto-refresh overview every 30s
setInterval(() => { if (currentPage === 'overview') loadOverview(); }, 30000);

init();
