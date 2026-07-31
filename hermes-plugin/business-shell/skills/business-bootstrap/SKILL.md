---
name: business-bootstrap
description: Use when a business owner needs guided first-run setup.
version: 1.0.0
author: Hermes Business
license: MIT
metadata:
  hermes:
    tags: [onboarding, business, setup, connections, automation]
    related_skills: [business-context, google-workspace]
---

# Business Bootstrap

Use this Skill when the business shell starts a new installation or the user asks
to complete or repair business setup.

The goal is a useful, working Hermes installation. Do not merely explain setup:
inspect the current Hermes state, guide the user through the missing parts, use
Hermes' official mechanisms, verify each completed step, and persist progress.

## Conversation contract

- Speak in the user's preferred language. Default to clear, friendly Hebrew.
- Ask one question at a time. Ask at most two closely related questions together.
- Explain briefly why the next question or permission matters.
- Never present the whole questionnaire as one long list.
- Reuse facts already present in Profile, Memory, Sessions, or `business-context`.
- If an answer is incomplete, ask a focused follow-up instead of inventing facts.
- Let the user skip a step and record it as deferred.
- Do not claim a connection or test succeeded until an actual check passes.

## Safety contract

- Never request API keys, OAuth secrets, bot tokens, passwords, or recovery codes
  in chat.
- Use Hermes' provider, secrets, Skill, messaging, approval, and cron mechanisms.
- Before login, OAuth consent, installing a Skill, enabling a messaging platform,
  or granting scopes, explain the action and wait for explicit approval.
- Prefer the minimum useful scope and one high-value connection at a time.
- Use read-only verification first. Drafts are allowed; sending, publishing,
  deleting, paying, sharing, or committing externally requires explicit approval.
- Do not create a new runtime, scheduler, memory store, connector, or MCP server
  when Hermes already provides the capability.
- Do not create a giant system prompt.

## Resume and inspect

Begin every run by inspecting what already exists:

1. Active Profile and preferred language.
2. Provider/model readiness.
3. Stable user facts in Memory.
4. Existing `business-context` Skill.
5. Installed relevant Skills.
6. Configured messaging platforms and connections.
7. Scheduled tasks.
8. Any prior setup Session or deferred setup note.

If a trusted Hermes Desktop wrapper supplies a compact, verified snapshot from
the official status, Skills, messaging, and cron APIs, use that snapshot and do
not repeat those checks before the first question. Re-check only a field that is
missing, stale, or contradicted later.

Summarize only the missing or uncertain items. Resume from the first incomplete
phase; do not restart completed work.

The initial inspection must stay lightweight and finish in about 20 seconds:

- Prefer Hermes' Memory, Skills, session search, and known state/config files.
- Do not run `hermes doctor`, broad filesystem scans, dependency checks, network
  connectivity suites, or update checks during first-run conversation.
- Do not discover commands by repeatedly running `hermes --help` or subcommand
  `--help`. If a safe state query is not already known, mark that item uncertain
  and ask the next useful question.
- Run at most three short read-only tool calls before asking the first question.
- Health checks belong on the support screen or after the user explicitly asks
  for diagnostics; onboarding must never wait for a full diagnostic pass.

## Phase 1 — Person and working style

Learn gradually:

- name and role;
- preferred language and answer style;
- working hours;
- actions that always require approval;
- tasks the user most wants to save time on.

Persist short, stable facts through Hermes Memory/Profile mechanisms.

## Phase 2 — Business context

Learn gradually:

- business name and field;
- products and services;
- customer types;
- operating hours;
- communication style and repeated phrases;
- promises, prices, dates, or commitments the assistant must not make;
- recurring processes;
- systems, services, and files currently used.

Create or update one canonical `business-context` Skill. Keep durable business
details there instead of duplicating them in every prompt. Never store secrets.

## Phase 3 — Recommend one connection

Use the user's systems and desired time savings to recommend the single connection
with the clearest immediate value. Before recommending:

1. List installed Skills and available messaging platforms.
2. Check whether the connection is already configured.
3. Prefer an official Hermes Skill or messaging integration.
4. Explain the expected value, requested scopes, and approval boundary.

Examples:

- Gmail, Calendar, Drive, Docs, or Sheets -> `google-workspace`.
- Phone chat with the same agent -> Hermes Telegram messaging.
- WhatsApp -> clearly distinguish WhatsApp Business Cloud API from an unofficial
  WhatsApp Web/Baileys connection.

After approval, guide the official setup one step at a time. When user action is
required, give one precise instruction and wait.

Verify with a safe read-only check such as listing the next calendar event or
checking connection status. Do not send, edit, or publish as the connection test.

## Phase 4 — First reusable Skill

From the recurring processes, propose up to three useful Skills. Let the user
choose one. Create it through Hermes' Skill mechanism with:

- a clear trigger in natural language;
- required inputs;
- expected output;
- approval gates;
- references to `business-context`;
- a simple completion criterion.

Test it in a normal Hermes Session without naming the Skill explicitly. Confirm
that it is visible in the full Hermes Skills screen.

## Phase 5 — First scheduled task

Only after the needed connection and Skill are working, propose one useful
scheduled task. Describe its schedule in plain language and let the user approve
it. Create it with Hermes cron, run it once manually, and verify the durable
output before leaving it enabled.

## Completion

Finish with a concise setup summary:

- what was stored in Profile/Memory;
- which business Skill was created or updated;
- which connection is working and how it was verified;
- which Skill and scheduled task were created;
- which steps were deferred;
- where the same state appears in full Hermes.

Do not mark setup complete if the provider is unavailable or a claimed connection
has not passed its check.
