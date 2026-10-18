"""Authenticated plugin routes used by both Tachles UI surfaces."""
import asyncio
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from . import store
from .source import resolve

router = APIRouter()


class Link(BaseModel):
    model_config = ConfigDict(extra="forbid")
    link: str = Field(min_length=1, max_length=2048)


class Connect(Link):
    profiles: list[str] = Field(min_length=1, max_length=50)


class Selection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    profiles: list[str] = Field(min_length=1, max_length=50)


async def checked(link):
    try:
        async with asyncio.timeout(22):
            return await resolve(link)
    except Exception:
        raise HTTPException(422, "לא ניתן לאמת את הקהילה. בדקו את הקישור ושהאתר זמין לקריאה ציבורית") from None


@router.get("/makom")
async def status():
    rows = await asyncio.to_thread(store.profiles)
    for row in rows:
        row["binding"] = await asyncio.to_thread(store.binding_for, row["id"])
        row["connected"] = False
    bindings = {row["binding"]["revision"]: row["binding"] for row in rows if row["binding"]}
    async def verify(binding):
        try:
            async with asyncio.timeout(22):
                await resolve(binding["origin"] + "/public/" + binding["communitySlug"])
            return True
        except Exception:
            return False
    available = dict(zip(bindings, await asyncio.gather(*(verify(value) for value in bindings.values()))))
    for row in rows:
        row["connected"] = bool(row["binding"] and available.get(row["binding"]["revision"]) and await asyncio.to_thread(store.configured, row["id"]))
    return {"profiles": rows}


@router.post("/makom/resolve")
async def resolve_link(body: Link):
    return await checked(body.link)


@router.post("/makom/connect")
async def connect(body: Connect):
    resolved = await checked(body.link)
    binding = store.new_binding(resolved)
    try:
        await asyncio.to_thread(store.apply, body.profiles, binding)
    except (ValueError, OSError):
        raise HTTPException(409, "החיבור לא נשמר. בדקו שהמרחבים קיימים ושאין סקיל או חיבור ידני באותו שם") from None
    return {"binding": binding, "profiles": body.profiles, "verified": True}


@router.post("/makom/disconnect")
async def disconnect(body: Selection):
    try:
        await asyncio.to_thread(store.apply, body.profiles, None)
    except (ValueError, OSError):
        raise HTTPException(409, "לא ניתן להשלים את הניתוק; רעננו ובדקו את מצב החיבור") from None
    return {"disconnected": body.profiles}
