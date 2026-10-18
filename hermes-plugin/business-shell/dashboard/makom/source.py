"""Bounded live reads; MCP negotiation stays with the official Python SDK."""
from contextlib import asynccontextmanager
import asyncio
import httpx
from .contract import TOOLS, check_host, parse_link
from .tool_schema import adapt


@asynccontextmanager
async def upstream(binding):
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client
    from tools.mcp_tool import sdk_httpx
    await asyncio.to_thread(check_host, binding["origin"])
    # Official Hermes supports both installed SDK generations. Its resolver owns
    # which HTTP client ABI the SDK requires (httpx in 1.x, httpx2 in 2.x).
    async with sdk_httpx().AsyncClient(timeout=8, follow_redirects=False, trust_env=False) as http, \
            streamable_http_client(binding["origin"] + "/mcp", http_client=http) as streams:
        read, write = streams[:2]
        async with ClientSession(read, write) as session:
            await session.initialize()
            yield session


async def resolve(link):
    binding = parse_link(link)
    await asyncio.to_thread(check_host, binding["origin"])
    async with httpx.AsyncClient(timeout=8, follow_redirects=False, trust_env=False) as http:
        async with http.stream("GET", binding["origin"] + "/api/public/v1/communities/" + binding["communitySlug"]) as response:
            response.raise_for_status()
            body = b""
            async for part in response.aiter_bytes():
                body += part
                if len(body) > 65536:
                    raise ValueError("תשובת האתר גדולה מדי")
    import json
    community = json.loads(body).get("community", {})
    if community.get("slug") != binding["communitySlug"] or not isinstance(community.get("name"), str):
        raise ValueError("הכתובת אינה מחזירה קהילה תואמת של מקום")
    async with asyncio.timeout(12), upstream(binding) as session:
        tools = (await session.list_tools()).tools
        if not TOOLS.issubset({tool.name for tool in tools}):
            raise ValueError("באתר חסרים כלי הקריאה הנדרשים למקום")
        result = await session.call_tool("list_public_prayer_calendars", {"communitySlug": binding["communitySlug"]})
        if result.model_dump(by_alias=True).get("isError"):
            raise ValueError("לא ניתן לקרוא כרגע את מידע הקהילה")
    return {**binding, "name": community["name"][:200]}


async def bound_tools(binding):
    async with asyncio.timeout(12), upstream(binding) as session:
        listed = await session.list_tools()
    tools = []
    for original in listed.tools:
        if original.name not in TOOLS:
            continue
        tool = original.model_copy(deep=True)
        wire = adapt(tool.model_dump(by_alias=True))
        tools.append(type(tool).model_validate(wire))
    if len(tools) != len(TOOLS):
        raise ValueError("חסרים כלי קריאה")
    return tools
