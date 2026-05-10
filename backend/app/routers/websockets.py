"""
WebSocket endpoints for real-time GPS tracking.

ws://host/ws/motoboy/{delivery_id}?token=<jwt>
  → Motoboy sends: {"lat": float, "lng": float, "accuracy": float}
  ← Receives: {"event": "arrived_geofence"} when within 50m of destination

ws://host/ws/track/{tracking_token}
  → Customer tracking page (no auth required, uses ephemeral token)
  ← Receives: {"event": "gps_update", "lat": .., "lng": .., ...}
              {"event": "arrived", ...}
              {"event": "completed", ...}
"""
import math
import json
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db, AsyncSessionLocal
from app.models import Delivery, DeliveryStatus, User
from app.ws_manager import manager
from app.auth import verify_password
from app.config import settings
from jose import jwt, JWTError

router = APIRouter(tags=["WebSockets"])

ARRIVAL_RADIUS_METERS = 50.0


def _haversine(lat1, lng1, lat2, lng2) -> float:
    R = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


async def _get_user_from_token(token: str) -> User | None:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id = payload.get("sub")
    except JWTError:
        return None
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()


# ─── Motoboy WS ───────────────────────────────────────────────────────────────

@router.websocket("/ws/motoboy/{delivery_id}")
async def motoboy_ws(
    delivery_id: str,
    websocket: WebSocket,
    token: str = Query(...),
):
    # Authenticate motoboy
    user = await _get_user_from_token(token)
    if not user or not user.is_active:
        await websocket.close(code=4001, reason="Unauthorized")
        return

    # Validate delivery ownership
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Delivery).where(
                Delivery.id == delivery_id,
                Delivery.store_id == user.store_id,
            )
        )
        delivery: Delivery | None = result.scalar_one_or_none()

    if not delivery:
        await websocket.close(code=4004, reason="Delivery not found")
        return

    await manager.connect_motoboy(delivery_id, websocket)

    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)

            lat = float(data.get("lat", 0))
            lng = float(data.get("lng", 0))
            accuracy = data.get("accuracy")

            # Persist last GPS position
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(Delivery).where(Delivery.id == delivery_id))
                d: Delivery = result.scalar_one()
                d.last_lat = lat
                d.last_lng = lng
                d.last_position_at = datetime.now(timezone.utc)
                await db.commit()

                # Geofence check — only when in_transit
                if d.status == DeliveryStatus.in_transit:
                    dist = _haversine(lat, lng, d.dest_lat, d.dest_lng)
                    if dist <= ARRIVAL_RADIUS_METERS:
                        # Notify watchers
                        await manager.broadcast_to_watchers(delivery_id, {
                            "event": "arrival_geofence",
                            "delivery_id": delivery_id,
                            "distance_m": round(dist, 1),
                        })
                        # Notify the motoboy himself
                        await manager.send_to_motoboy(delivery_id, {
                            "event": "arrival_geofence",
                            "message": "Você chegou ao destino!",
                        })

            # Broadcast GPS update to watchers
            await manager.broadcast_to_watchers(delivery_id, {
                "event": "gps_update",
                "delivery_id": delivery_id,
                "lat": lat,
                "lng": lng,
                "accuracy": accuracy,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })

    except WebSocketDisconnect:
        await manager.disconnect_motoboy(delivery_id)
    except Exception as e:
        await manager.disconnect_motoboy(delivery_id)


# ─── Customer Tracking WS ─────────────────────────────────────────────────────

@router.websocket("/ws/track/{tracking_token}")
async def tracking_ws(tracking_token: str, websocket: WebSocket):
    # Validate token
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Delivery).where(Delivery.tracking_token == tracking_token)
        )
        delivery: Delivery | None = result.scalar_one_or_none()

    if not delivery:
        await websocket.close(code=4004, reason="Invalid tracking token")
        return

    # Check expiry
    if delivery.tracking_expires_at and datetime.now(timezone.utc) > delivery.tracking_expires_at:
        await websocket.close(code=4010, reason="Tracking link expired")
        return

    await manager.connect_watcher(delivery.id, websocket)

    try:
        # Keep alive — customer only receives, doesn't send
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await manager.disconnect_watcher(delivery.id, websocket)
    except Exception:
        await manager.disconnect_watcher(delivery.id, websocket)
