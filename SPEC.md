# SPEC — journal-mcp-server

## What it is
A small remote MCP server, pulled out of ReflectAI, that lets Claude (or any MCP client) read and write one owner's journal entries over Streamable HTTP, with a minimal OAuth 2.0 flow so it works in Claude's connector settings. It is a public reference and portfolio piece for agent tool design, permission scoping and OAuth. How it works, the tools and the environment variables are documented in `README.md`; keep those details there.

## What must stay true
- One owner, one agent. Every tool call is scoped to `MCP_USER_EMAIL`.
- `/mcp` rejects any request without the bearer token and returns a `WWW-Authenticate` header pointing at the OAuth metadata.
- The OAuth flow requires PKCE, and auth codes are single use with a short lifetime.
- Each tool declares all four MCP behaviour hints, and read tools never write.
- Tools depend only on the `JournalStore` interface, never on a specific database.
- Tests run with the in-memory store and need no server, port or secrets.
- No real journal data, secrets or personal details are ever committed. The repo is public.

## Not building
- Multi-user accounts or multi-tenancy.
- A delete or bulk-edit tool.
- A persistent production database in this repo (ReflectAI owns that).
- A UI beyond the OAuth consent page.

## Status
- Main: working reference server with five tools and tests.
- Eval harness for this server is being built on the `evals` branch (agent evaluation and governance plan, Phase 1).
