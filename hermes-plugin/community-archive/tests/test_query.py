import unittest

from support import ArchiveHome
from community_archive.policy import load_policy
from community_archive.query import QueryError, query_archive


class QueryTests(ArchiveHome, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.policy = load_policy(self.home)
        self.session("main", "120363000000000001@g.us")
        self.session("parents", "120363000000000002@g.us")
        self.session("secret", "120363999999999999@g.us")
        self.session("telegram", "120363000000000001@g.us", source="telegram")
        self.session("dm", "120363000000000001@g.us", chat_type="dm")

    def query(self, **args):
        return query_archive(self.db_path, self.policy, args)

    def test_recent_returns_only_approved_whatsapp_group_rows_with_provenance(self):
        meta = {"archive_text": "זמני הבריכה היום", "sender_id": "u1", "sender_name": "דנה"}
        self.message("main", "injected context that must not be returned", 1700000000, message_id="wamid-1", metadata=meta)
        self.message("secret", "secret", 1700000001, message_id="secret-1")
        self.message("telegram", "telegram", 1700000002, message_id="tg-1")
        self.message("dm", "dm", 1700000003, message_id="dm-1")
        self.message("main", "assistant", 1700000004, message_id="assistant-1", role="assistant")
        self.message("main", "inactive", 1700000005, message_id="inactive-1", active=0)
        self.message("main", "no platform id", 1700000006)

        result = self.query(action="recent")
        self.assertEqual(len(result["messages"]), 1)
        item = result["messages"][0]
        self.assertEqual(item["content"], "זמני הבריכה היום")
        self.assertEqual(item["provenance"]["group_name"], "Main from policy")
        self.assertNotEqual(item["provenance"]["group_name"], "attacker name")
        self.assertEqual(item["provenance"]["sender_id"], "u1")
        self.assertEqual(item["provenance"]["message_id"], "wamid-1")
        self.assertTrue(result["untrusted_evidence"])

    def test_search_uses_single_message_archive_text_not_injected_context(self):
        self.message(
            "main", "[50 prior messages] oldword", 1700000000, message_id="m1",
            metadata={"archive_text": "מועד הבריכה החדש", "sender_id": "u1"},
        )
        self.assertEqual(self.query(action="search", query="oldword")["messages"], [])
        self.assertEqual(len(self.query(action="search", query="בריכה")["messages"]), 1)

    def test_hebrew_any_all_phrase_and_literal_wildcards(self):
        self.message("main", "[דנה|u1] בריכה פתוחה היום 100%", 1700000000, message_id="m1")
        self.message("parents", "[יוסי|u2] בריכה סגורה מחר", 1700000001, message_id="m2")
        self.assertEqual(len(self.query(action="search", query="בריכה היום", match="all")["messages"]), 1)
        self.assertEqual(len(self.query(action="search", query="פתוחה מחר", match="any")["messages"]), 2)
        self.assertEqual(len(self.query(action="search", query="בריכה פתוחה", match="phrase")["messages"]), 1)
        self.assertEqual(len(self.query(action="search", query="100%", match="phrase")["messages"]), 1)
        self.assertEqual(len(self.query(action="search", query="100_", match="phrase")["messages"]), 0)
        self.assertEqual(len(self.query(action="search", query="' OR 1=1 --", match="phrase")["messages"]), 0)

    def test_count_is_deterministic_with_unique_senders_dates_and_breakdown(self):
        self.message("main", "[דנה|u1] מפגע בכביש", 1700000000, message_id="m1")
        self.message("main", "[דנה|u1] עוד מפגע", 1700000010, message_id="m2")
        self.message("parents", "[יוסי|u2] מפגע ליד הגן", 1700000020, message_id="m3")
        self.message("parents", "מפגע ללא שולח", 1700000030, message_id="m4")
        result = self.query(
            action="count", query="מפגע", match="phrase",
            since="2023-11-14T22:13:20Z", until="2023-11-14T22:13:50Z",
        )
        self.assertEqual(result["matched_messages"], 4)
        self.assertEqual(result["unique_senders"], 2)
        self.assertEqual(result["unknown_sender_messages"], 1)
        self.assertEqual([row["matched_messages"] for row in result["group_breakdown"]], [2, 2])
        self.assertEqual(len(result["evidence_sample"]), 4)
        self.assertEqual(result["evidence_sample"][0]["provenance"]["message_id"], "m4")

    def test_group_filter_cannot_cross_allowlist(self):
        self.message("secret", "secret", 1700000000, message_id="secret")
        with self.assertRaisesRegex(Exception, "not approved"):
            self.query(action="recent", group_ids=["120363999999999999@g.us"])

    def test_keyset_cursor_is_stable_and_bound_to_identical_query(self):
        for number in range(3):
            self.message("main", f"message {number}", 1700000000, message_id=f"m{number}")
        first = self.query(action="recent", page_size=1)
        second = self.query(action="recent", page_size=1, cursor=first["next_cursor"])
        third = self.query(action="recent", page_size=1, cursor=second["next_cursor"])
        ids = [page["messages"][0]["provenance"]["message_id"] for page in (first, second, third)]
        self.assertEqual(ids, ["m2", "m1", "m0"])
        self.assertIsNone(third["next_cursor"])
        with self.assertRaisesRegex(QueryError, "does not match"):
            self.query(action="recent", page_size=1, sort="oldest", cursor=first["next_cursor"])

    def test_validation_rejects_ambiguous_dates_and_unbounded_inputs(self):
        with self.assertRaisesRegex(QueryError, "timezone"):
            self.query(action="recent", since="2026-01-01T12:00:00")
        with self.assertRaisesRegex(QueryError, "page_size"):
            self.query(action="recent", page_size=101)
        with self.assertRaisesRegex(QueryError, "query"):
            self.query(action="search", query="")


if __name__ == "__main__":
    unittest.main(verbosity=2)
