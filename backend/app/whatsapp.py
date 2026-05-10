"""
WhatsApp notification service using Evolution API (open-source).
Swap the send_message implementation for the official Meta WABA if needed.
"""
import logging
from typing import Optional
import httpx
from app.config import settings

logger = logging.getLogger(__name__)


async def send_whatsapp_message(phone: str, message: str) -> bool:
    """
    Send a WhatsApp message via Evolution API.
    Returns True on success, False on failure.

    Phone format: international without '+' — e.g., '5511999998888'
    """
    if not settings.WHATSAPP_API_URL or not settings.WHATSAPP_API_KEY:
        logger.warning("[WhatsApp] API not configured — message NOT sent (dev mode)")
        logger.info(f"[WhatsApp] Would send to {phone}: {message}")
        return False

    # Normalize phone: strip non-digits
    phone_clean = "".join(c for c in phone if c.isdigit())

    url = f"{settings.WHATSAPP_API_URL.rstrip('/')}/message/sendText/{settings.WHATSAPP_PHONE_NUMBER_ID}"
    headers = {"apikey": settings.WHATSAPP_API_KEY, "Content-Type": "application/json"}
    payload = {
        "number": phone_clean,
        "textMessage": {"text": message},
        "delay": 1000,
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
            logger.info(f"[WhatsApp] Message sent to {phone_clean}")
            return True
    except httpx.HTTPStatusError as e:
        logger.error(f"[WhatsApp] HTTP error {e.response.status_code}: {e.response.text}")
        return False
    except Exception as e:
        logger.error(f"[WhatsApp] Unexpected error: {e}")
        return False


def render_template(template: str, **kwargs) -> str:
    """Simple template rendering using str.format_map."""
    try:
        return template.format_map(kwargs)
    except KeyError as e:
        logger.warning(f"[WhatsApp] Template key missing: {e}")
        return template


async def notify_dispatched(
    phone: str,
    customer_name: str,
    store_name: str,
    tracking_url: str,
    template: Optional[str] = None,
) -> bool:
    tpl = template or (
        "Olá {customer_name}! 🛵 Seu pedido da {store_name} saiu para entrega. "
        "Acompanhe em tempo real: {tracking_url}"
    )
    msg = render_template(tpl, customer_name=customer_name, store_name=store_name, tracking_url=tracking_url)
    return await send_whatsapp_message(phone, msg)


async def notify_arrived(
    phone: str,
    store_name: str,
    delivery_code: str,
    template: Optional[str] = None,
) -> bool:
    tpl = template or "🎉 O motoboy chegou! Pode descer para receber seu pedido da {store_name}. O seu código de entrega é: *{delivery_code}*"
    msg = render_template(tpl, store_name=store_name, delivery_code=delivery_code)
    return await send_whatsapp_message(phone, msg)
