"""Behavioral coverage for short live reads, ambiguity and Israel-local dates."""
from datetime import datetime
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock
from zoneinfo import ZoneInfo
from makom.reads import read, prayer_arguments
from makom.tool_schema import adapt


def response(value, error=False):
    return SimpleNamespace(model_dump=lambda **_: {"structuredContent": value, "isError": error})


class DateTests(TestCase):
    def test_defaults_and_tomorrow_use_israel_date_across_midnight_and_dst(self):
        for utc, day, tomorrow in [("2026-10-18T22:30:00+00:00", "2026-10-19", "2026-10-20"),
                                   ("2026-10-24T22:30:00+00:00", "2026-10-25", "2026-10-26")]:
            at = datetime.fromisoformat(utc).astimezone(ZoneInfo("Asia/Jerusalem"))
            self.assertEqual(prayer_arguments({}, at)["localDate"], day)
            self.assertEqual(prayer_arguments({"day": "tomorrow"}, at)["localDate"], tomorrow)
            self.assertEqual(prayer_arguments({"localDate": "2026-11-01"}, at)["localDate"], "2026-11-01")
            for args in ({"day": "yesterday"}, {"day": "today", "localDate": day}):
                with self.assertRaises(ValueError):
                    prayer_arguments(args, at)

    def test_prayer_schema_allows_one_date_choice_and_stays_bound(self):
        import jsonschema
        wire = adapt({"name": "get_public_prayer_day", "description": "old",
            "inputSchema": {"type": "object", "properties": {"communitySlug": {"type": "string"},
                "localDate": {"type": "string"}}, "required": ["communitySlug", "localDate"]}})
        for args in ({}, {"day": "tomorrow"}, {"localDate": "2026-10-18"}):
            jsonschema.validate(args, wire["inputSchema"])
        for args in ({"communitySlug": "other"}, {"day": "tomorrow", "localDate": "2026-10-18"}):
            with self.assertRaises(jsonschema.ValidationError):
                jsonschema.validate(args, wire["inputSchema"])


class LiveReadTests(IsolatedAsyncioTestCase):
    def setUp(self):
        self.binding = {"communitySlug": "village"}
        self.at = datetime.fromisoformat("2026-10-18T16:29:00+03:00")
        self.envelope = {"asOf": "2026-10-18T13:29:10Z", "canonicalUrl": "https://example.com/public/village"}

    async def test_prayer_reads_both_calendars_in_one_call_and_keeps_missing(self):
        session = SimpleNamespace(call_tool=AsyncMock(return_value=response({**self.envelope,
            "status": "missing", "calendars": [{"publicId": "a"}, {"publicId": "b"}]})))
        value = await read(session, self.binding, "get_public_prayer_day", {}, self.at)
        session.call_tool.assert_awaited_once_with("get_public_prayer_day", {"communitySlug": "village", "localDate": "2026-10-18"})
        self.assertEqual(value["status"], "missing")
        self.assertEqual(value["clock"]["checkedAtLocal"], "2026-10-18T16:29:10+03:00")
        self.assertEqual(len(value["calendars"]), 2)

    async def test_named_service_event_and_information_read_details_in_same_tool(self):
        for name, kind in (("get_public_service_hours", "service"), ("get_public_event_timetable", "event"), ("get_public_resource", None)):
            search = {**self.envelope, "items": [{"publicId": "only"}], "nextCursor": None}
            detail = {**self.envelope, "status": "cancelled" if kind == "event" else "unknown"}
            session = SimpleNamespace(call_tool=AsyncMock(side_effect=[response(search), response(detail)]))
            value = await read(session, self.binding, name, {"query": "מרפאה"}, self.at)
            self.assertEqual(session.call_tool.await_count, 2)
            args = session.call_tool.await_args_list[0].args[1]
            self.assertEqual(args.get("kind"), kind)
            self.assertEqual(args.get("period"), "all" if kind == "event" else None)
            self.assertEqual(session.call_tool.await_args_list[1].args, (name, {"communitySlug": "village", "publicId": "only"}))
            self.assertEqual(value["status"], detail["status"])

    async def test_multiple_no_matches_and_truncated_search_never_choose_arbitrarily(self):
        for items, cursor, status in (([], None, "not_found"), ([{"publicId": "a"}, {"publicId": "b"}], None, "needs_selection"),
                                      ([{"publicId": "a"}], "more", "needs_selection")):
            session = SimpleNamespace(call_tool=AsyncMock(return_value=response({**self.envelope, "items": items, "nextCursor": cursor})))
            value = await read(session, self.binding, "get_public_service_hours", {"query": "מרפאה"}, self.at)
            self.assertEqual(value["status"], status)
            self.assertEqual(session.call_tool.await_count, 1)

    async def test_explicit_id_preserves_date_range_and_only_reads_once(self):
        session = SimpleNamespace(call_tool=AsyncMock(return_value=response(self.envelope)))
        args = {"publicId": "clinic", "fromDate": "2026-10-20", "toDate": "2026-10-20"}
        await read(session, self.binding, "get_public_service_hours", args, self.at)
        session.call_tool.assert_awaited_once_with("get_public_service_hours", {**args, "communitySlug": "village"})

    async def test_failed_or_invalid_reads_do_not_become_empty_success(self):
        session = SimpleNamespace(call_tool=AsyncMock(return_value=response({}, True)))
        with self.assertRaises(ValueError):
            await read(session, self.binding, "get_public_prayer_day", {}, self.at)
        for args in ({"query": ""}, {"query": "clinic", "publicId": "x"}, {"communitySlug": "other"}):
            with self.assertRaises(ValueError):
                await read(session, self.binding, "get_public_service_hours", args, self.at)
