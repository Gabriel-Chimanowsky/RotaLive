import httpx
import asyncio

async def test():
    async with httpx.AsyncClient() as c:
        try:
            r = await c.get('http://127.0.0.1:8080/instance/connectionState/teste', headers={'apikey':'rotalive_master_key'})
            print("Status:", r.status_code)
            print("Response:", r.text)
        except Exception as e:
            print("Error:", str(e))

asyncio.run(test())
