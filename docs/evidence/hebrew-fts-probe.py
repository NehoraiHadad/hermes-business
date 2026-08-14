"""Empirical probe: does SQLite FTS5 retrieve Hebrew community-chat text?

Compares the three tokenizers Hermes' state.db already creates (unicode61 via
messages_fts, trigram via messages_fts_trigram) against realistic Hebrew group
chatter where the query word carries an attached prefix (ו/ה/ב/ל/כ/מ/ש) or a
different ktiv male spelling than the indexed text.
"""
import sqlite3

CORPUS = [
    "הבריכה נפתחת ביום ראשון בשעה שבע",
    "מישהו יודע מתי בבריכה יש שיעור שחייה?",
    "לבריכה הגעתי אתמול והיה סגור",
    "החימום בבית הכנסת לא עובד",
    "החמום במקווה תוקן אתמול",
    "יש הסעה לתלמידים בשעה שבע וחצי",
    "ההסעות מתעכבות היום בגלל הגשם",
]

# (label, query) — what a resident would actually type
QUERIES = [
    ("bare word, indexed with prefix", "בריכה"),
    ("bare word, indexed bare+prefixed", "חימום"),
    ("ktiv male variance", "חמום"),
    ("plural vs singular", "הסעה"),
    ("exact word present", "שחייה"),
]


def build(conn, name, tokenize):
    conn.execute(f"CREATE VIRTUAL TABLE {name} USING fts5(body, tokenize='{tokenize}')")
    conn.executemany(f"INSERT INTO {name}(body) VALUES (?)", [(c,) for c in CORPUS])


def probe(conn, table, query):
    try:
        rows = conn.execute(
            f"SELECT body FROM {table} WHERE {table} MATCH ? ORDER BY rank", (f'"{query}"',)
        ).fetchall()
        return [r[0] for r in rows]
    except sqlite3.OperationalError as exc:
        return f"ERROR: {exc}"


def main():
    print("sqlite", sqlite3.sqlite_version)
    conn = sqlite3.connect(":memory:")

    tokenizers = [("uni", "unicode61"), ("tri", "trigram")]
    available = []
    for name, tok in tokenizers:
        try:
            build(conn, name, tok)
            available.append((name, tok))
            print(f"tokenizer {tok}: OK")
        except sqlite3.OperationalError as exc:
            print(f"tokenizer {tok}: UNAVAILABLE ({exc})")

    print()
    for label, q in QUERIES:
        print(f"--- {label}: query={q!r}")
        for name, tok in available:
            hits = probe(conn, name, q)
            if isinstance(hits, str):
                print(f"    {tok:10s} {hits}")
            else:
                print(f"    {tok:10s} {len(hits)} hit(s)")
                for h in hits:
                    print(f"        {h}")
        print()


if __name__ == "__main__":
    main()
