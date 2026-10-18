"""Convenience reads over the unchanged public Makom contract, without inference."""
from datetime import datetime, timedelta
import asyncio
import json
import re
from zoneinfo import ZoneInfo
from .contract import bound_arguments

ZONE = ZoneInfo("Asia/Jerusalem")
RESOLVABLE = {"get_public_service_hours": "service", "get_public_event_timetable": "event",
              "get_public_resource": None}


def name_query(query):
    """Conservative Hebrew construct/article variant (מרפאה → מרפא)."""
    def token(match):
        text = match[0]
        if len(text) > 4 and text.startswith("ה"):
            text = text[1:]
        return text[:-1] if len(text) >= 4 and text.endswith(("ה", "ת")) else text
    return re.sub(r"[א-ת]+", token, query)


def payload(result):
    wire = result.model_dump(by_alias=True)
    if wire.get("isError"):
        raise ValueError("The live source could not confirm the information")
    if isinstance(wire.get("structuredContent"), dict):
        return wire["structuredContent"]
    for block in wire.get("content", []):
        if block.get("type") == "text":
            value = json.loads(block["text"])
            if isinstance(value, dict):
                return value
    raise ValueError("No structured public source")


def clock(at, as_of):
    checked = datetime.fromisoformat(as_of.replace("Z", "+00:00"))
    if checked.tzinfo is None:
        raise ValueError("Source time must include an offset")
    return {"timezone": "Asia/Jerusalem", "now": at.isoformat(),
            "localDate": at.date().isoformat(), "localTime": at.strftime("%H:%M"),
            "checkedAtLocal": checked.astimezone(ZONE).isoformat(timespec="seconds")}


def prayer_arguments(arguments, at):
    args = dict(arguments)
    day = args.pop("day", None)
    if day not in (None, "today", "tomorrow") or (day and "localDate" in args):
        raise ValueError("Choose one date or relative day")
    if "localDate" not in args:
        args["localDate"] = (at.date() + timedelta(days=day == "tomorrow")).isoformat()
    return args


async def read(session, binding, name, arguments, at=None):
    at = at or datetime.now(ZONE)
    args = bound_arguments(binding, name, arguments)
    if name == "get_public_prayer_day":
        args = prayer_arguments(args, at)
    selected = None
    if name in RESOLVABLE and "query" in args:
        query = args.pop("query")
        if "publicId" in args or not isinstance(query, str) or not 1 <= len(query.strip()) <= 120:
            raise ValueError("Choose a publication id or a short search query")
        search = {"communitySlug": binding["communitySlug"], "q": name_query(query.strip()), "limit": 5}
        if RESOLVABLE[name]:
            search["kind"] = RESOLVABLE[name]
        if RESOLVABLE[name] == "event":
            # Named cancellations/past events remain searchable while published.
            search["period"] = "all"
        matches = payload(await session.call_tool("search_public_information", search))
        items = matches["items"]
        if not items or matches.get("nextCursor") or len(items) > 5:
            value = {**matches, "status": "needs_selection" if items or matches.get("nextCursor") else "not_found"}
            return result(value, at)
        if len(items) > 1:
            async def detail(item):
                publication = {key: item[key] for key in ("publicId", "title", "kind", "canonicalUrl") if key in item}
                try:
                    value = payload(await session.call_tool(name, {**args, "publicId": item["publicId"]}))
                    return {**publication, "details": result(value, at)}
                except Exception:
                    # Keep successful siblings, but never turn an unreadable
                    # publication into an empty schedule or an inferred closure.
                    return {**publication, "status": "unavailable"}
            values = await asyncio.gather(*(detail(item) for item in items))
            return result({**matches, "status": "multiple_matches", "items": values}, at)
        selected = {key: items[0][key] for key in ("publicId", "title", "kind", "canonicalUrl") if key in items[0]}
        args["publicId"] = selected["publicId"]
    value = payload(await session.call_tool(name, args))
    if selected:
        value["matchedPublication"] = selected
    return result(value, at)


def result(value, at):
    return {**value, "clock": clock(at, value["asOf"]), "localTimes": local_times(value)}


def local_times(value):
    """Mirror precise source times in Israel time, preserving nulls and indexes."""
    if isinstance(value, list):
        converted = [local_times(item) for item in value]
        return converted if any(converted) else []
    times = {}
    for key, item in value.items():
        if key in ("startsAt", "endsAt", "nextTransitionAt", "instant"):
            if item is None:
                times[key] = None
            else:
                instant = datetime.fromisoformat(item.replace("Z", "+00:00"))
                if instant.tzinfo is None:
                    raise ValueError("Source instant must include an offset")
                times[key] = instant.astimezone(ZONE).isoformat(timespec="seconds")
        elif isinstance(item, (dict, list)):
            converted = local_times(item)
            if converted:
                times[key] = converted
    return times
