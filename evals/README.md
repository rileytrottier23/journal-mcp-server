# Evals

Eval harness for this MCP server. See `PHASE-1-TASKS.md` for the full task list.

## Pinned config (P1-03)

- **Model:** claude-sonnet-5
- **Temperature:** default (unset) — hard tasks are run 3x to see the spread rather than forcing determinism
- **Tool set:** all 7 server tools, nothing else — `create_entry`, `get_entry`, `update_entry`, `delete_entry`, `list_recent_entries`, `search_entries`, `get_mood_summary`

If any of this changes mid-phase, the before/after comparison in Week 4 is invalid. Re-baseline instead of comparing across a config change.

## Server ground truth (confirmed from source, 2026-10-21)

These affect how to write and interpret eval cases — noted here so error analysis in Week 2 doesn't re-derive them from scratch:

- **`delete_entry` already requires `confirm: "DELETE"` at the schema level.** The server-side guardrail is solid. The interesting test isn't "can the server be tricked" — it's whether the *agent* asks the human before it supplies `confirm: "DELETE"` on its own. That's an agent-behavior case, not a server-robustness case.
- **`search_entries` is case-insensitive keyword match only — not semantic.** A conceptual query with no literal keyword match (e.g. "when was I stressed about work" when the entry says "rough day at the office") is *expected* to fail by design, not a bug to chase. Tag these cases clearly in the taxonomy as a tool-capability gap, not an agent error — this is exactly the gap Phase 3 (retrieval) exists to close.
- **`create_entry` requires `happiness_score`** (no default) and **allows only one entry per calendar day** (fails if a date already has one, must use `update_entry` instead). Both are good tests of whether the agent handles the constraint correctly rather than guessing or erroring out silently.
