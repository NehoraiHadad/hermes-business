"""Behavioral coverage for short live reads, ambiguity and Israel-local dates."""
from datetime import datetime
import asyncio
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock
from zoneinfo import ZoneInfo
from makom.reads import read, prayer_arguments, local_times
from makom.tool_schema import adapt


def response(value, error=False):
    return SimpleNamespace(model_dump=lambda **_: {"structuredContent": value, "isError": error})


class DateTests(TestCase):
    def test_source_times_convert_across_dst_without_inventing_missing_ends(self):
        value = {"nextTransitionAt": "2026-10-25T05:00:00Z", "entries": [
            {"startsAt": "2026-10-24T15:00:00Z", "endsAt": None},
            {"startsAt": "2026-10-25T15:00:00Z", "endsAt": "2026-10-25T16:00:00Z"}]}
        converted = local_times(value)
        self.assertEqual(converted["nextTransitionAt"], "2026-10-25T07:00:00+02:00")
        self.assertEqual(converted["entries"][0], {"startsAt": "2026-10-24T18:00:00+03:00", "endsAt": None})
        self.assertEqual(converted["entries"][1]["startsAt"], "2026-10-25T17:00:00+02:00")
        self.assertEqual(value["entries"][0]["startsAt"], "2026-10-24T15:00:00Z")
        with self.assertRaises(ValueError):
            local_times({"startsAt": "2026-10-24T18:00:00"})

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

    async def test_empty_or_truncated_search_never_silently_returns_a_partial_schedule(self):
        for items, cursor, status in (([], None, "not_found"),
                                      ([{"publicId": "a"}], "more", "needs_selection"),
                                      ([{"publicId": str(n)} for n in range(6)], None, "needs_selection")):
            session = SimpleNamespace(call_tool=AsyncMock(return_value=response({**self.envelope, "items": items, "nextCursor": cursor})))
            value = await read(session, self.binding, "get_public_service_hours", {"query": "clinic"}, self.at)
            self.assertEqual(value["status"], status)
            self.assertEqual(session.call_tool.await_count, 1)

    async def test_small_complete_sets_read_every_detail_concurrently_and_preserve_dates(self):
        items = [{"publicId": str(n), "title": "שירות " + str(n)} for n in range(5)]
        for name in ("get_public_service_hours", "get_public_event_timetable", "get_public_resource"):
            started, all_started = set(), asyncio.Event()
            async def call(tool, args):
                if tool == "search_public_information":
                    return response({**self.envelope, "items": items, "nextCursor": None})
                self.assertEqual(args["communitySlug"], "village")
                self.assertEqual(args["fromDate"], "2026-10-20")
                started.add(args["publicId"])
                if len(started) == len(items):
                    all_started.set()
                await asyncio.wait_for(all_started.wait(), 1)
                return response({**self.envelope, "status": "unknown", "publicId": args["publicId"]})
            session = SimpleNamespace(call_tool=AsyncMock(side_effect=call))
            value = await read(session, self.binding, name,
                {"query": "המרפאה", "fromDate": "2026-10-20"}, self.at)
            self.assertEqual(session.call_tool.await_args_list[0].args[1]["q"], "מרפא")
            self.assertEqual(value["status"], "multiple_matches")
            self.assertEqual([item["publicId"] for item in value["items"]], [item["publicId"] for item in items])
            for item in value["items"]:
                self.assertEqual(item["details"]["publicId"], item["publicId"])
                self.assertEqual(item["details"]["status"], "unknown")
                self.assertEqual(item["details"]["clock"]["checkedAtLocal"], "2026-10-18T16:29:10+03:00")

    async def test_unavailable_sibling_keeps_valid_results_without_faking_empty_hours(self):
        async def call(name, args):
            if name == "search_public_information":
                return response({**self.envelope, "items": [{"publicId": "good"}, {"publicId": "bad"}]})
            return response({**self.envelope, "openNow": True}, error=args["publicId"] == "bad")
        value = await read(SimpleNamespace(call_tool=AsyncMock(side_effect=call)), self.binding,
            "get_public_service_hours", {"query": "clinic"}, self.at)
        self.assertTrue(value["items"][0]["details"]["openNow"])
        self.assertEqual(value["items"][1], {"publicId": "bad", "status": "unavailable"})
        import jsonschema
        wire = adapt({"name": "get_public_service_hours", "description": "old",
            "inputSchema": {"type": "object", "properties": {}},
            "outputSchema": {"type": "object", "properties": {"asOf": {"type": "string"}}, "required": ["asOf"]}})
        jsonschema.validate(value, wire["outputSchema"])

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
