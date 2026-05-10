"""
Deliveries router — CRUD + status management + ephemeral tracking links.
"""
import math
import random
import string
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.database import get_db
from app.models import Delivery, DeliveryStatus, Store, User
from app.schemas import DeliveryCreate, DeliveryOut, DeliveryPublicOut, DeliveryCompleteRequest
from app.auth import get_current_user, require_admin, require_motoboy_or_admin
from app.config import settings
from app import whatsapp
from app.ws_manager import manager

router = APIRouter(prefix="/api/deliveries", tags=["Deliveries"])

ARRIVAL_RADIUS_METERS = 50.0
TRACKING_EXPIRY_MINUTES = 15  # after completion/cancellation


def _haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Distance in metres between two GPS coords."""
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _mask_delivery(d: Delivery) -> dict:
    """Mask sensitive fields after completion."""
    masked = DeliveryOut.model_validate(d).model_dump()
    if d.status in (DeliveryStatus.completed, DeliveryStatus.cancelled):
        masked["customer_phone"] = "***"
        masked["customer_address"] = "Endereço ocultado"
    return masked


# ─── Admin: create delivery ───────────────────────────────────────────────────

@router.post("", response_model=DeliveryOut, status_code=201)
async def create_delivery(
    payload: DeliveryCreate,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    delivery = Delivery(
        store_id=current_user.store_id,
        motoboy_id=payload.motoboy_id,
        customer_name=payload.customer_name,
        customer_phone=payload.customer_phone,
        customer_address=payload.customer_address,
        dest_lat=payload.dest_lat,
        dest_lng=payload.dest_lng,
        delivery_code="".join(random.choices(string.digits, k=4))
    )
    db.add(delivery)
    await db.flush()
    await db.refresh(delivery)
    return delivery


# ─── List deliveries ──────────────────────────────────────────────────────────

@router.get("", response_model=list[dict])
async def list_deliveries(
    status: Optional[DeliveryStatus] = Query(None),
    current_user: User = Depends(require_motoboy_or_admin),
    db: AsyncSession = Depends(get_db),
):
    query = select(Delivery).where(Delivery.store_id == current_user.store_id)

    # Motoboys only see their own deliveries
    if current_user.role.value == "motoboy":
        query = query.where(Delivery.motoboy_id == current_user.id)

    if status:
        query = query.where(Delivery.status == status)

    query = query.order_by(Delivery.created_at.desc())
    result = await db.execute(query)
    deliveries = result.scalars().all()
    return [_mask_delivery(d) for d in deliveries]


# ─── Get single delivery ──────────────────────────────────────────────────────

@router.get("/{delivery_id}", response_model=dict)
async def get_delivery(
    delivery_id: str,
    current_user: User = Depends(require_motoboy_or_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Delivery).where(
            Delivery.id == delivery_id,
            Delivery.store_id == current_user.store_id,
        )
    )
    delivery = result.scalar_one_or_none()
    if not delivery:
        raise HTTPException(status_code=404, detail="Entrega não encontrada")
    return _mask_delivery(delivery)


# ─── Public tracking page ──────────────────────────────────────────────────────

@router.get("/track/{token}", response_model=DeliveryPublicOut)
async def track_delivery(token: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Delivery).where(Delivery.tracking_token == token))
    d: Delivery | None = result.scalar_one_or_none()

    if not d:
        raise HTTPException(status_code=404, detail="Link de rastreio inválido")

    # Check expiry
    if d.tracking_expires_at and datetime.now(timezone.utc) > d.tracking_expires_at:
        raise HTTPException(status_code=410, detail="Link de rastreio expirado")

    store_result = await db.execute(select(Store).where(Store.id == d.store_id))
    store: Store = store_result.scalar_one()

    motoboy_name = None
    if d.motoboy_id:
        mb_result = await db.execute(select(User).where(User.id == d.motoboy_id))
        mb = mb_result.scalar_one_or_none()
        motoboy_name = mb.name if mb else None

    return DeliveryPublicOut(
        id=d.id,
        status=d.status,
        store_name=store.name,
        store_primary_color=store.primary_color,
        store_secondary_color=store.secondary_color,
        store_logo=store.logo_path,
        dest_lat=d.dest_lat,
        dest_lng=d.dest_lng,
        last_lat=d.last_lat,
        last_lng=d.last_lng,
        last_position_at=d.last_position_at,
        dispatched_at=d.dispatched_at,
        arrived_at=d.arrived_at,
        motoboy_name=motoboy_name,
    )


# ─── Dispatch (start delivery) ────────────────────────────────────────────────

@router.post("/{delivery_id}/dispatch")
async def dispatch_delivery(
    delivery_id: str,
    current_user: User = Depends(require_motoboy_or_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Delivery).where(
            Delivery.id == delivery_id,
            Delivery.store_id == current_user.store_id,
        )
    )
    d: Delivery | None = result.scalar_one_or_none()
    if not d:
        raise HTTPException(status_code=404, detail="Entrega não encontrada")
    if d.status != DeliveryStatus.pending:
        raise HTTPException(status_code=400, detail="Entrega já iniciada")

    d.status = DeliveryStatus.in_transit
    d.dispatched_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(d)

    # Load store for templates
    store_result = await db.execute(select(Store).where(Store.id == d.store_id))
    store: Store = store_result.scalar_one()

    # Fire WhatsApp notification (async, don't block response)
    if not d.notified_dispatched:
        tracking_url = f"{settings.FRONTEND_URL}/track/{d.tracking_token}"
        templates = store.whatsapp_templates or {}
        ok = await whatsapp.notify_dispatched(
            phone=d.customer_phone,
            customer_name=d.customer_name,
            store_name=store.name,
            tracking_url=tracking_url,
            template=templates.get("dispatched"),
        )
        if ok:
            d.notified_dispatched = True
            await db.flush()

    return {"status": "dispatched", "tracking_token": d.tracking_token}


# ─── Mark arrived ─────────────────────────────────────────────────────────────

@router.post("/{delivery_id}/arrive")
async def mark_arrived(
    delivery_id: str,
    current_user: User = Depends(require_motoboy_or_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Delivery).where(
            Delivery.id == delivery_id,
            Delivery.store_id == current_user.store_id,
        )
    )
    d: Delivery | None = result.scalar_one_or_none()
    if not d:
        raise HTTPException(status_code=404, detail="Entrega não encontrada")
    if d.status != DeliveryStatus.in_transit:
        raise HTTPException(status_code=400, detail="Entrega não está em trânsito")

    d.status = DeliveryStatus.arrived
    d.arrived_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(d)

    store_result = await db.execute(select(Store).where(Store.id == d.store_id))
    store: Store = store_result.scalar_one()

    # WhatsApp notification
    if not d.notified_arrived:
        templates = store.whatsapp_templates or {}
        ok = await whatsapp.notify_arrived(
            phone=d.customer_phone,
            store_name=store.name,
            delivery_code=d.delivery_code or "",
            template=templates.get("arrived"),
        )
        if ok:
            d.notified_arrived = True
            await db.flush()

    # Broadcast arrival event to all watchers
    await manager.broadcast_to_watchers(delivery_id, {
        "event": "arrived",
        "delivery_id": delivery_id,
        "arrived_at": d.arrived_at.isoformat(),
    })

    return {"status": "arrived"}


# ─── Complete delivery ────────────────────────────────────────────────────────

@router.post("/{delivery_id}/complete")
async def complete_delivery(
    delivery_id: str,
    payload: DeliveryCompleteRequest,
    current_user: User = Depends(require_motoboy_or_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Delivery).where(
            Delivery.id == delivery_id,
            Delivery.store_id == current_user.store_id,
        )
    )
    d: Delivery | None = result.scalar_one_or_none()
    if not d:
        raise HTTPException(status_code=404, detail="Entrega não encontrada")

    store_result = await db.execute(select(Store).where(Store.id == d.store_id))
    store: Store = store_result.scalar_one()

    if store.require_delivery_code and d.delivery_code:
        if payload.code != d.delivery_code:
            raise HTTPException(status_code=400, detail="Código de entrega inválido")

    d.status = DeliveryStatus.completed
    d.completed_at = datetime.now(timezone.utc)
    # Ephemeral link: expires 15 minutes from now
    d.tracking_expires_at = datetime.now(timezone.utc) + timedelta(minutes=TRACKING_EXPIRY_MINUTES)
    await db.flush()

    await manager.broadcast_to_watchers(delivery_id, {
        "event": "completed",
        "delivery_id": delivery_id,
    })

    return {"status": "completed"}


# ─── Cancel delivery ──────────────────────────────────────────────────────────

@router.post("/{delivery_id}/cancel")
async def cancel_delivery(
    delivery_id: str,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Delivery).where(
            Delivery.id == delivery_id,
            Delivery.store_id == current_user.store_id,
        )
    )
    d: Delivery | None = result.scalar_one_or_none()
    if not d:
        raise HTTPException(status_code=404, detail="Entrega não encontrada")

    d.status = DeliveryStatus.cancelled
    d.tracking_expires_at = datetime.now(timezone.utc) + timedelta(minutes=TRACKING_EXPIRY_MINUTES)
    await db.flush()

    await manager.broadcast_to_watchers(delivery_id, {"event": "cancelled", "delivery_id": delivery_id})
    return {"status": "cancelled"}


# ─── Dashboard stats ──────────────────────────────────────────────────────────

@router.get("/stats/summary")
async def delivery_stats(
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    base = select(func.count(Delivery.id)).where(Delivery.store_id == current_user.store_id)
    total = (await db.execute(base)).scalar()
    active = (await db.execute(base.where(Delivery.status == DeliveryStatus.in_transit))).scalar()
    completed = (await db.execute(base.where(Delivery.status == DeliveryStatus.completed))).scalar()
    pending = (await db.execute(base.where(Delivery.status == DeliveryStatus.pending))).scalar()
    return {"total": total, "active": active, "completed": completed, "pending": pending}
