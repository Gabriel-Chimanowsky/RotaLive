import os
import aiofiles
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models import Store, User
from app.schemas import StoreCreate, StoreOut, StoreUpdate
from app.auth import get_current_user, require_admin

router = APIRouter(prefix="/api/stores", tags=["Stores"])

UPLOAD_DIR = "uploads/logos"
os.makedirs(UPLOAD_DIR, exist_ok=True)


@router.post("", response_model=StoreOut, status_code=201)
async def create_store(payload: StoreCreate, db: AsyncSession = Depends(get_db)):
    # Check slug uniqueness
    result = await db.execute(select(Store).where(Store.slug == payload.slug))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Slug já em uso")

    store = Store(**payload.model_dump())
    db.add(store)
    await db.flush()
    await db.refresh(store)
    return store


@router.get("/me", response_model=StoreOut)
async def get_my_store(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Store).where(Store.id == current_user.store_id))
    store = result.scalar_one_or_none()
    if not store:
        raise HTTPException(status_code=404, detail="Loja não encontrada")
    return store


@router.patch("/me", response_model=StoreOut)
async def update_store(
    payload: StoreUpdate,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Store).where(Store.id == current_user.store_id))
    store: Store | None = result.scalar_one_or_none()
    if not store:
        raise HTTPException(status_code=404, detail="Loja não encontrada")

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(store, field, value)

    await db.flush()
    await db.refresh(store)
    return store


@router.post("/me/logo", response_model=StoreOut)
async def upload_logo(
    file: UploadFile = File(...),
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Arquivo deve ser uma imagem")

    ext = file.filename.split(".")[-1].lower()
    filename = f"{current_user.store_id}.{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)

    async with aiofiles.open(filepath, "wb") as f:
        content = await file.read()
        await f.write(content)

    result = await db.execute(select(Store).where(Store.id == current_user.store_id))
    store: Store = result.scalar_one()
    store.logo_path = f"/uploads/logos/{filename}"
    await db.flush()
    await db.refresh(store)
    return store


@router.get("/{slug}/public")
async def get_store_public(slug: str, db: AsyncSession = Depends(get_db)):
    """Public endpoint — returns only branding info for tracking page."""
    result = await db.execute(select(Store).where(Store.slug == slug))
    store = result.scalar_one_or_none()
    if not store:
        raise HTTPException(status_code=404, detail="Loja não encontrada")
    return {
        "name": store.name,
        "primary_color": store.primary_color,
        "secondary_color": store.secondary_color,
        "logo_path": store.logo_path,
    }
