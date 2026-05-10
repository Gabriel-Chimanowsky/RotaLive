import logging
import httpx
from fastapi import APIRouter, Depends, HTTPException
from app.auth import require_admin
from app.models import User
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/whatsapp", tags=["WhatsApp"])

# O .env tem essas variáveis
EVO_URL = settings.WHATSAPP_API_URL.split("/message/")[0] if settings.WHATSAPP_API_URL else "http://127.0.0.1:8080"
EVO_KEY = settings.WHATSAPP_API_KEY or "rotalive_master_key"

async def _get_client():
    return httpx.AsyncClient(timeout=15.0, headers={"apikey": EVO_KEY})

@router.get("/instance")
async def get_whatsapp_instance(current_user: User = Depends(require_admin)):
    """
    Retorna o status da conexão do WhatsApp e o QR Code (em base64) se não estiver conectado.
    """
    if not settings.WHATSAPP_API_URL:
        # Modo dev se não tiver configurado no .env
        pass
        
    instance_name = f"rotalive_{current_user.store_id}"
    
    try:
        async with await _get_client() as client:
            # 1. Verifica se a instância existe buscando o connectionState
            logger.info(f"Checking instance: {instance_name}")
            resp = await client.get(f"{EVO_URL}/instance/connectionState/{instance_name}")
            
            if resp.status_code == 404:
                # Instância não existe -> Cria
                create_payload = {
                    "instanceName": instance_name,
                    "qrcode": True,
                    "integration": "WHATSAPP-BAILEYS"
                }
                c_resp = await client.post(f"{EVO_URL}/instance/create", json=create_payload)
                c_resp.raise_for_status()
                
                # Tenta pegar o connect logo após criar
                conn_resp = await client.get(f"{EVO_URL}/instance/connect/{instance_name}")
                if "base64" in conn_resp.json():
                    return {"state": "disconnected", "qr": conn_resp.json()["base64"]}
                return {"state": "disconnected", "qr": None}
            
            resp.raise_for_status()
            data = resp.json()
            state = data.get("instance", {}).get("state", "close")
            
            if state == "open":
                return {"state": "connected", "qr": None}
            
            # Se não está open, precisamos do QR code
            conn_resp = await client.get(f"{EVO_URL}/instance/connect/{instance_name}")
            conn_data = conn_resp.json()
            if "base64" in conn_data:
                return {"state": "disconnected", "qr": conn_data["base64"]}
            
            return {"state": "disconnected", "qr": None}

    except httpx.ConnectError:
        logger.error("[Evolution] Falha ao conectar. A API está rodando no Docker?")
        raise HTTPException(status_code=503, detail="A Evolution API não está respondendo. Verifique se o Docker está rodando.")
    except Exception as e:
        logger.error(f"[Evolution API] Erro: {e}")
        raise HTTPException(status_code=500, detail="Erro ao se comunicar com o WhatsApp")

@router.delete("/instance")
async def logout_whatsapp_instance(current_user: User = Depends(require_admin)):
    """Desconecta o WhatsApp e exclui a instância."""
    instance_name = f"rotalive_{current_user.store_id}"
    try:
        async with await _get_client() as client:
            resp = await client.delete(f"{EVO_URL}/instance/logout/{instance_name}")
            if resp.status_code not in (200, 404):
                resp.raise_for_status()
        return {"status": "logged_out"}
    except Exception as e:
        logger.error(f"[Evolution API] Logout erro: {e}")
        raise HTTPException(status_code=500, detail="Erro ao desconectar")
