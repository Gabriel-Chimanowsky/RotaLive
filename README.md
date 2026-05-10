# RotaLive — SaaS de Rastreamento de Entregas em Tempo Real

<p align="center">
  <img src="https://img.shields.io/badge/FastAPI-0.111-009688?style=flat-square&logo=fastapi" />
  <img src="https://img.shields.io/badge/Python-3.11+-3776AB?style=flat-square&logo=python" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-3.x-06B6D4?style=flat-square&logo=tailwindcss" />
  <img src="https://img.shields.io/badge/WebSockets-Real--time_GPS-10B981?style=flat-square" />
</p>

## 📦 Estrutura do Projeto

```
RotaLive/
├── backend/               # FastAPI Python backend
│   ├── app/
│   │   ├── main.py        # Entry point
│   │   ├── config.py      # Settings (env vars)
│   │   ├── database.py    # Async SQLAlchemy
│   │   ├── models.py      # ORM models
│   │   ├── schemas.py     # Pydantic schemas
│   │   ├── auth.py        # JWT + password utils
│   │   ├── ws_manager.py  # WebSocket connection manager
│   │   ├── whatsapp.py    # WhatsApp notification service
│   │   ├── seed.py        # Default admin seed
│   │   └── routers/
│   │       ├── auth.py
│   │       ├── stores.py
│   │       ├── users.py
│   │       ├── deliveries.py
│   │       └── websockets.py
│   └── requirements.txt
│
└── frontend/              # Vite + Tailwind CSS frontend
    ├── index.html         # Login page
    ├── src/
    │   ├── style.css      # Global styles + design system
    │   ├── api.js         # API client + helpers
    │   └── pages/
    │       ├── login.js
    │       ├── dashboard.html   # Admin panel
    │       ├── dashboard.js
    │       ├── motoboy.html     # Motoboy PWA
    │       ├── motoboy.js
    │       ├── track.html       # Customer tracking
    │       └── track.js
    └── vite.config.js
```

## 🚀 Como Rodar (Desenvolvimento)

### Backend

```bash
cd backend

# 1. Criar e ativar ambiente virtual
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # Linux/Mac

# 2. Instalar dependências
pip install -r requirements.txt

# 3. Configurar variáveis de ambiente
copy .env.example .env
# Edite .env com suas chaves

# 4. Rodar o servidor
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# Acesse: http://localhost:5173
```

## 🔐 Credenciais Padrão

| Campo  | Valor              |
|--------|--------------------|
| Email  | admin@rotalive.com |
| Senha  | Admin@2024!        |

> ⚠️ Altere imediatamente em produção!

## 🌐 URLs das Interfaces

| Interface          | URL                                    |
|--------------------|----------------------------------------|
| Login              | `http://localhost:5173/`               |
| Dashboard Admin    | `http://localhost:5173/src/pages/dashboard.html` |
| Área do Motoboy    | `http://localhost:5173/src/pages/motoboy.html`   |
| Rastreio Cliente   | `http://localhost:5173/src/pages/track.html?token=<UUID>` |
| API Docs           | `http://localhost:8000/docs`           |

## 📡 WebSockets

| Endpoint                                   | Quem usa         |
|--------------------------------------------|------------------|
| `ws://host/ws/motoboy/{delivery_id}?token=` | Motoboy (GPS)    |
| `ws://host/ws/track/{tracking_token}`       | Cliente (watch)  |

## 🎨 White-Label

No Dashboard Admin → **White-Label**:
- Upload do logo
- Cores primária e secundária (variáveis CSS)
- Templates de mensagem WhatsApp customizáveis

## 📱 Funcionalidades

- ✅ GPS em tempo real via WebSockets
- ✅ Geofence de 50m para detecção automática de chegada
- ✅ Links efêmeros (expiram 15 min após conclusão)
- ✅ Notificações WhatsApp (despacho + chegada)
- ✅ Vibração do celular (HTML5 Vibration API)
- ✅ JWT auth com roles (admin / motoboy)
- ✅ Rate limiting nos endpoints críticos
- ✅ Mascaramento de dados após entrega concluída
- ✅ Dark mode nativo (motoboy)
- ✅ White-label completo por loja
- ✅ PWA-ready (motoboy mobile)
