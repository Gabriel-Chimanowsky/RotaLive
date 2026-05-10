"""
WebSocket Connection Manager for real-time GPS tracking.

Each delivery has its own "room":
  - Motoboy sends GPS updates → broadcast to all tracking clients
  - Customer tracking page listens → receives position updates
"""
import asyncio
import json
from collections import defaultdict
from typing import Dict, Set
from fastapi import WebSocket
import logging

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self):
        # delivery_id → set of WebSocket connections (customers watching)
        self._watchers: Dict[str, Set[WebSocket]] = defaultdict(set)
        # delivery_id → motoboy WebSocket (only one at a time)
        self._motoboys: Dict[str, WebSocket] = {}
        self._lock = asyncio.Lock()

    # ── Motoboy connections ──────────────────────────────────────────────────

    async def connect_motoboy(self, delivery_id: str, ws: WebSocket):
        await ws.accept()
        async with self._lock:
            # Disconnect previous motoboy WS if any
            if delivery_id in self._motoboys:
                try:
                    await self._motoboys[delivery_id].close()
                except Exception:
                    pass
            self._motoboys[delivery_id] = ws
        logger.info(f"[WS] Motoboy connected → delivery {delivery_id}")

    async def disconnect_motoboy(self, delivery_id: str):
        async with self._lock:
            self._motoboys.pop(delivery_id, None)
        logger.info(f"[WS] Motoboy disconnected → delivery {delivery_id}")

    # ── Watcher (customer) connections ──────────────────────────────────────

    async def connect_watcher(self, delivery_id: str, ws: WebSocket):
        await ws.accept()
        async with self._lock:
            self._watchers[delivery_id].add(ws)
        logger.info(f"[WS] Watcher connected → delivery {delivery_id} ({len(self._watchers[delivery_id])} total)")

    async def disconnect_watcher(self, delivery_id: str, ws: WebSocket):
        async with self._lock:
            self._watchers[delivery_id].discard(ws)
        logger.info(f"[WS] Watcher disconnected → delivery {delivery_id}")

    # ── Broadcasting ─────────────────────────────────────────────────────────

    async def broadcast_to_watchers(self, delivery_id: str, payload: dict):
        """Send a JSON message to all customer watchers of a delivery."""
        message = json.dumps(payload)
        dead: Set[WebSocket] = set()

        async with self._lock:
            watchers = set(self._watchers[delivery_id])

        for ws in watchers:
            try:
                await ws.send_text(message)
            except Exception:
                dead.add(ws)

        # Cleanup dead connections
        if dead:
            async with self._lock:
                self._watchers[delivery_id] -= dead

    async def send_to_motoboy(self, delivery_id: str, payload: dict):
        """Send a JSON message to the motoboy (e.g., arrival confirmation)."""
        ws = self._motoboys.get(delivery_id)
        if ws:
            try:
                await ws.send_text(json.dumps(payload))
            except Exception:
                await self.disconnect_motoboy(delivery_id)

    def active_watchers(self, delivery_id: str) -> int:
        return len(self._watchers.get(delivery_id, set()))


# Singleton instance
manager = ConnectionManager()
