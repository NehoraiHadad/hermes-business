"""Convenience reads over the unchanged public Makom contract, without inference."""
from datetime import datetime, timedelta
import json
from zoneinfo import ZoneInfo
from .contract import bound_arguments

ZONE = ZoneInfo("Asia/Jerusalem")
RESOLVABLE = {"get_public_service_hours": "service", "get_public_event_timetable": "event",
              "get_public_resource": None}


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
    if name in RESOLVABLE and "query" in args:
        query = args.pop("query")
        if "publicId" in args or not isinstance(query, str) or not 1 <= len(query.strip()) <= 120:
            raise ValueError("Choose a publication id or a short search query")
        search = {"communitySlug": binding["communitySlug"], "q": query.strip(), "limit": 5}
        if RESOLVABLE[name]:
            search["kind"] = RESOLVABLE[name]
        if RESOLVABLE[name] == "event":
            # Named cancellations/past events remain searchable while published.
            search["period"] = "all"
        matches = payload(await session.call_tool("search_public_information", search))
        items = matches["items"]
        if len(items) != 1 or matches.get("nextCursor"):
            value = {**matches, "status": "needs_selection" if items else "not_found"}
            return result(value, at)
        args["publicId"] = items[0]["publicId"]
    return result(payload(await session.call_tool(name, args)), at)


def result(value, at):
    return {**value, "clock": clock(at, value["asOf"])}
