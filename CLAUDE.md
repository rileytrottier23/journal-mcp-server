# CLAUDE.md — journal-mcp-server

Read `SPEC.md` first (what this is and what must stay true), then `README.md` (architecture, tools, auth, env vars).

## How to work with Riley
- Plan before coding. For anything bigger than a small fix, write a short plan and wait for a yes.
- If a change isn't in `SPEC.md`, say so and ask whether to update the spec first.
- Push back. If an idea is weak, risky or out of scope, say why. Don't just agree.
- Explain changes in plain language. Riley is a PM, not a full-time engineer.
- Show a task list for multi-step work.

## Working habits
- **Docs vs code:** when a doc (this file, `SPEC.md`, README) and the code disagree, follow the code, and list every mismatch you found in your final reply so the doc can be fixed.
- **Prove it works:** run the checks before saying something works, and paste the output. At the end of a task, say what you didn't test.
- **Never weaken tests:** don't weaken or delete an existing assertion or test to make a change pass. Fix the code, or stop and ask.
- **Read, then edit:** run the checks once before changing anything, so you know what was already failing. Then list the files you need, read them in one pass, make all the edits, and run the checks again.
- **No stray files:** don't create new markdown files without asking. Each fact lives in one file; update that file instead of starting another.
- **Say your assumptions:** before coding, state what you are assuming. If the request could mean two things, name both and ask instead of picking one quietly.
- **Surgical changes:** touch only the lines the task needs. Don't reformat or refactor nearby code. Mention unrelated dead code instead of deleting it, but remove anything your own change left unused.

## Commands
| Task | Command |
|---|---|
| Install | `npm install` |
| Dev server (port 3000) | `npm run dev` |
| Build / typecheck | `npm run build` |
| Tests | `npm test` |

## Layout
- `src/server.ts` Express app and routes
- `src/mcp.ts` tool definitions (Zod schemas, behaviour hints)
- `src/mcpAuth.ts` bearer-token check on `/mcp`
- `src/oauth.ts` OAuth metadata, consent page, code and token endpoints
- `src/journalStore.ts` `JournalStore` interface and the in-memory store
- `test/tools.test.ts` tool tests over the in-memory MCP transport

## Rules
- **Tests:** any change to a tool, auth or OAuth needs a test. Done means `npm run build` and `npm test` pass.
- **Secrets:** never commit `.env` or tokens. This repo is public.
- **No real data:** test fixtures use made-up entries only.
