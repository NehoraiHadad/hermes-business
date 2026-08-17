# Tachles–Hermes capability test brief

This is a new evaluation session. The primary goal is to exercise and assess
the current new Tachles–Hermes capabilities end to end. Do not start by
building more features.

First inspect the current workspace and git diff. Read
`docs/specs/community-whatsapp-execution-plan.md` and the latest community
handoff. Honor the user's architectural decision: the intended product has one
Hermes installation, one gateway, one WhatsApp connection, and one
`HERMES_HOME`.

Start with temporary or otherwise isolated homes and fixtures. Test:

- conversational community setup;
- generated profiles, routes, and tool fences;
- `community_archive` recent/search/count, provenance, pagination, and unique
  sender behavior;
- passive WhatsApp observation and restart persistence;
- exactly one bounded 50-message immediate-context window;
- denial for residents, disallowed groups, and data outside server policy;
- packaged community CLI imports;
- existing QR and AI-provider surfaces without overwriting live authentication
  or pairing state.

Clearly separate deterministic evidence from scenarios that require a real
phone or account. Report what works, what fails, and the smallest next fix.

Do not deploy, commit, push, open or modify pull requests, or mutate live
WhatsApp/authentication unless the user explicitly directs you through Remote
Control. Keep Remote Control active for mobile.
