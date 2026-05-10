"""
Seed default admin + store on first run.
"""
import logging
from sqlalchemy import select
from app.database import AsyncSessionLocal
from app.models import Store, User, UserRole
from app.auth import hash_password

logger = logging.getLogger(__name__)

DEFAULT_STORE_SLUG = "demo"
DEFAULT_ADMIN_EMAIL = "admin@rotalive.com"
DEFAULT_ADMIN_PASSWORD = "Admin@2024!"


async def seed_default_data():
    async with AsyncSessionLocal() as db:
        # Check if default store exists
        result = await db.execute(select(Store).where(Store.slug == DEFAULT_STORE_SLUG))
        store = result.scalar_one_or_none()

        if not store:
            store = Store(
                name="RotaLive Demo",
                slug=DEFAULT_STORE_SLUG,
                primary_color="#1E1B4B",
                secondary_color="#10B981",
            )
            db.add(store)
            await db.flush()
            logger.info(f"[Seed] Created default store: {store.slug}")

        # Check if admin exists
        result = await db.execute(select(User).where(User.email == DEFAULT_ADMIN_EMAIL))
        admin = result.scalar_one_or_none()

        if not admin:
            admin = User(
                store_id=store.id,
                name="Admin RotaLive",
                email=DEFAULT_ADMIN_EMAIL,
                hashed_password=hash_password(DEFAULT_ADMIN_PASSWORD),
                role=UserRole.admin,
            )
            db.add(admin)
            await db.flush()
            logger.info(f"[Seed] Created default admin: {admin.email} / {DEFAULT_ADMIN_PASSWORD}")

        await db.commit()
