"""
FastAPI application entry point.
"""
import os
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from app.config import settings
from app.database import init_db
from app.routers import auth, stores, users, deliveries, websockets, whatsapp_instance
from app.seed import seed_default_data

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

# Rate limiter
limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
    await seed_default_data()
    os.makedirs("uploads/logos", exist_ok=True)
    yield
    # Shutdown (cleanup if needed)


app = FastAPI(
    title="RotaLive API",
    description="Real-time delivery tracking SaaS",
    version="1.0.0",
    lifespan=lifespan,
)

# ── Middleware ──────────────────────────────────────────────────────────────────

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static files (logo uploads) ───────────────────────────────────────────────

os.makedirs("uploads", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(auth.router)
app.include_router(stores.router)
app.include_router(users.router)
app.include_router(deliveries.router)
app.include_router(websockets.router)
app.include_router(whatsapp_instance.router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "RotaLive API"}
