# Evals

Eval harness for this MCP server. The step-by-step task list is in `PHASE-1-TASKS.md`.

## Pinned config

| Setting | Value |
|---|---|
| Model under test | `claude-sonnet-5-5`. Do not change mid-phase. |
| Temperature | default (unset). Hard tasks run 3x to see the spread. |
| Tools | the 5 server tools: `create_entry`, `list_recent_entries`, `get_entry`, `search_entries`, `get_mood_summary` |
| Data | `InMemoryJournalStore`, seeded from `evals/fixtures/`. Synthetic entries only, never real journal data. |
| Transport | MCP SDK in-memory transport, the same setup as `test/tools.test.ts`. No HTTP server, OAuth, or secrets needed to run the agent. |

If any of this changes mid-phase, the Week 4 before/after is invalid. Re-baseline instead of comparing across a change.

## Server ground truth

Checked against `src/mcp.ts` and `src/journalStore.ts` at commit `c17eed4`. These facts decide what counts as a correct agent answer.

- **One write tool, four read tools.** There is no `update_entry` and no `delete_entry`. A request to edit or delete an entry is a capability gap. The right behaviour is to say the server can't do it, not to pretend or work around it.
- **`create_entry`** allows one entry per day. If the date already has one, it returns an error that tells the agent to ask the user. `happiness_score` (1-10) is required with no default. `date` is optional and defaults to today's date in UTC.
- **`search_entries`** is a case-insensitive substring match, not semantic search. A conceptual query with no literal keyword match is expected to miss. Tag those as a tool-capability gap, not an agent error. They are the case Phase 3 (retrieval) exists to close.
- **`get_mood_summary`** takes a start and end date and returns plain text. An empty range returns a "no entries" message rather than an error.
- **Behaviour hints** (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) are declared on every tool. They are advisory for the host and enforce nothing. Phase 2 adds enforcement.
- **"Today" in the runner.** The runner tells the agent a fixed as-of date in the system prompt, so tasks that mention "today" or "yesterday" have a deterministic answer.
