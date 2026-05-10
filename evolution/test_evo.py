import asyncio
import httpx

EVO_URL = "http://localhost:8080"
EVO_KEY = "rotalive_master_key"

async def test():
    async with httpx.AsyncClient(headers={"apikey": EVO_KEY}) as client:
        # Create
        print("Creating instance...")
        res = await client.post(f"{EVO_URL}/instance/create", json={
            "instanceName": "test_instance",
            "qrcode": True,
            "integration": "WHATSAPP-BAILEYS"
        })
        print(res.status_code, res.text)
        
        # Status
        print("Getting status...")
        res2 = await client.get(f"{EVO_URL}/instance/connectionState/test_instance")
        print(res2.status_code, res2.text)
        
        # Connect
        print("Connecting...")
        res3 = await client.get(f"{EVO_URL}/instance/connect/test_instance")
        print(res3.status_code, res3.text[:200])

asyncio.run(test())
