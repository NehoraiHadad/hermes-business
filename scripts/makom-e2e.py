"""Real Hermes + Makom integration, isolated from the operator's Hermes home.

Run with the installed Hermes Python. Only public reads reach the local Makom
site; no model inference, provider credentials or WhatsApp dispatch is used.
"""
import asyncio
import json
import os
from pathlib import Path
import sys
import tempfile
from datetime import datetime
from zoneinfo import ZoneInfo


async def exercise(home, link):
    from hermes_cli.profiles import create_profile, get_profile_dir
    from makom import store
    from makom.source import resolve
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    create_profile("residents", no_alias=True, no_skills=True, description="מרחב תושבים לבדיקה")
    assert get_profile_dir("default").resolve() == home
    assert get_profile_dir("residents").resolve().is_relative_to(home)
    resolved = await resolve(link)
    binding = store.new_binding(resolved)
    await asyncio.to_thread(store.apply, ["residents"], binding)
    assert not store.binding_for("default")
    cfg = store.read_config(store.profile_home("residents"))
    name = cfg["tachles_makom"]["serverName"]
    server = cfg["mcp_servers"][name]
    report = {"resolved": resolved["communitySlug"], "nativeProbe": True, "unselectedProfileUnchanged": True}
    params = StdioServerParameters(command=server["command"], args=server["args"], env={**os.environ, **server.get("env", {}), "PYTHONUTF8": "1"})
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as client:
            await client.initialize()
            tools = (await client.list_tools()).tools
            assert len(tools) == 6
            assert all("communitySlug" not in tool.model_dump(by_alias=True)["inputSchema"]["properties"] for tool in tools)
            calendars = await client.call_tool("list_public_prayer_calendars", {})
            assert not calendars.model_dump(by_alias=True).get("isError", False), calendars
            data = calendars.model_dump(by_alias=True)["structuredContent"]
            assert data["community"]["slug"] == resolved["communitySlug"]
            calendar = next(row for row in data["items"] if row["kind"] == "prayer-minyans")
            prayer = await client.call_tool("get_public_prayer_day", {"localDate": datetime.now(ZoneInfo("Asia/Jerusalem")).date().isoformat(), "calendarId": calendar["publicId"]})
            assert not prayer.model_dump(by_alias=True).get("isError", False)
            assert prayer.model_dump(by_alias=True)["structuredContent"]["community"]["slug"] == resolved["communitySlug"]
            assert prayer.model_dump(by_alias=True)["structuredContent"]["asOf"]
            today = await client.call_tool("get_public_prayer_day", {})
            today_data = today.model_dump(by_alias=True)["structuredContent"]
            assert today_data["localDate"] == today_data["clock"]["localDate"]
            assert today_data["clock"]["checkedAtLocal"]
            assert len(today_data["calendars"]) >= 1
            forbidden = await client.call_tool("list_public_prayer_calendars", {"communitySlug": "another-community"})
            assert forbidden.model_dump(by_alias=True).get("isError", False)
            report.update({"tools": len(tools), "liveRead": True, "prayerRead": True,
                "defaultTodayWithLocalClock": True, "communityOverrideDenied": True})
            await asyncio.to_thread(store.apply, ["residents"], None)
            revoked = await client.call_tool("list_public_prayer_calendars", {})
            assert revoked.model_dump(by_alias=True).get("isError", False)
            report["runningProcessRevoked"] = True
    assert not store.skill_path(store.profile_home("residents")).exists()
    assert name not in store.read_config(store.profile_home("residents")).get("mcp_servers", {})
    report["disconnectCleanup"] = True
    await exercise_native_registry(resolved, report)
    return report


async def exercise_native_registry(resolved, report):
    """One native process must not reuse another profile or binding's session."""
    from makom import store
    from tools.mcp_tool_discovery import register_mcp_servers
    from tools.mcp_tool_lifecycle import shutdown_mcp_servers
    from tools.mcp_tool_schema import mcp_prefixed_tool_name
    from tools.registry import registry

    async def register(profile):
        cfg = store.read_config(store.profile_home(profile))
        name = cfg["tachles_makom"]["serverName"]
        await asyncio.to_thread(register_mcp_servers, cfg["mcp_servers"])
        tools = registry.get_tool_names_for_toolset("mcp-" + name)
        assert len(tools) == 6 and all(len(tool) <= 64 for tool in tools), tools
        return name, mcp_prefixed_tool_name(name, "list_public_prayer_calendars")

    async def read(tool):
        return str(await asyncio.to_thread(registry.dispatch, tool, {}))

    try:
        await asyncio.to_thread(store.apply, ["default", "residents"], store.new_binding(resolved))
        primary, primary_tool = await register("default")
        residents, old_tool = await register("residents")
        assert primary != residents
        assert 'MAKOM_UNAVAILABLE' not in await read(primary_tool)
        assert 'MAKOM_UNAVAILABLE' not in await read(old_tool)
        await asyncio.to_thread(store.apply, ["residents"], store.new_binding(resolved))
        renewed, new_tool = await register("residents")
        assert renewed not in (primary, residents)
        current = await read(new_tool)
        assert resolved["communitySlug"] in current and 'MAKOM_UNAVAILABLE' not in current, current
        assert 'MAKOM_UNAVAILABLE' in await read(old_tool)
        assert 'MAKOM_UNAVAILABLE' not in await read(primary_tool)
        await asyncio.to_thread(store.apply, ["default", "residents"], None)
        assert 'MAKOM_UNAVAILABLE' in await read(new_tool)
        report.update({"nativeMultiProfileRegistration": True, "nativeReconnection": True, "nativeOldBindingRevoked": True})
    finally:
        await asyncio.to_thread(shutdown_mcp_servers)


def main():
    root = Path(__file__).resolve().parent.parent
    sys.path.insert(0, str(root / "hermes-plugin/business-shell/dashboard"))
    link = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000/public/shadmot"
    with tempfile.TemporaryDirectory(prefix="tachles-makom-e2e-") as directory:
        home = Path(directory).resolve()
        os.environ["HERMES_HOME"] = str(home)
        os.environ.pop("HERMES_PROFILE", None)
        (home / "config.yaml").write_text("model:\n  provider: openrouter\n  default: test-not-used\n", encoding="utf-8")
        try:
            result = asyncio.run(exercise(home, link))
        except Exception:
            output = root / ".artifacts/makom"
            output.mkdir(parents=True, exist_ok=True)
            for log in home.rglob("mcp-stderr.log"):
                (output / "probe-stderr.log").write_bytes(log.read_bytes())
            raise
        finally:
            # The native probe owns a process-wide stderr log handle. Release
            # this isolated process's handle before deleting its temp home.
            import tools.mcp_tool as native_mcp
            handle = native_mcp._get_mcp_stderr_log()
            if handle is not sys.stderr:
                handle.close()
    output = root / ".artifacts/makom"
    output.mkdir(parents=True, exist_ok=True)
    (output / "integration.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
