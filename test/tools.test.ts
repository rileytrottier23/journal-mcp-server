/**
 * Tool tests — drive the real MCP server through an in-memory transport,
 * the same way an MCP client would, backed by InMemoryJournalStore.
 *
 * Run: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp.js";
import { InMemoryJournalStore } from "../src/journalStore.js";

const USER = "test-user";

async function connect(store = new InMemoryJournalStore(), userId = USER) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(store, userId);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, store };
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text: string }>;
  return { isError: result.isError === true, text: content.map((c) => c.text).join("\n") };
}

async function seed(client: Client) {
  await call(client, "create_entry", { content: "Rainy walk by the harbour", happiness_score: 3, date: "2026-01-01" });
  await call(client, "create_entry", { content: "Quiet day, read a book", happiness_score: 6, date: "2026-01-02" });
  await call(client, "create_entry", { content: "Long WALK in the sun", happiness_score: 9, date: "2026-01-03" });
}

test("every tool declares an input schema and all four behaviour hints", async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();

  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ["create_entry", "get_entry", "get_mood_summary", "list_recent_entries", "search_entries"],
  );

  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, "object", `${tool.name} input schema`);
    assert.ok(Object.keys(tool.inputSchema.properties ?? {}).length > 0, `${tool.name} has properties`);
    for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const) {
      assert.equal(typeof tool.annotations?.[hint], "boolean", `${tool.name}.${hint}`);
    }
    assert.equal(tool.annotations?.readOnlyHint, tool.name !== "create_entry", `${tool.name} readOnlyHint`);
    assert.equal(tool.annotations?.destructiveHint, false, `${tool.name} destructiveHint`);
  }
});

test("create_entry stores an entry and refuses a second one for the same date", async () => {
  const { client, store } = await connect();

  const first = await call(client, "create_entry", { content: "First", happiness_score: 7, date: "2026-02-01" });
  assert.equal(first.isError, false);
  assert.match(first.text, /2026-02-01/);
  assert.equal((await store.getEntry(USER, "2026-02-01"))?.content, "First");

  const second = await call(client, "create_entry", { content: "Second", happiness_score: 2, date: "2026-02-01" });
  assert.equal(second.isError, true);
  assert.match(second.text, /already exists/);
  assert.equal((await store.getEntry(USER, "2026-02-01"))?.content, "First");
});

test("create_entry defaults the date to today", async () => {
  const { client, store } = await connect();
  await call(client, "create_entry", { content: "No date given", happiness_score: 5 });
  const today = new Date().toISOString().split("T")[0];
  assert.equal((await store.getEntry(USER, today))?.content, "No date given");
});

test("create_entry rejects invalid input", async () => {
  const { client, store } = await connect();
  const bad = [
    { content: "x", happiness_score: 11, date: "2026-03-01" },
    { content: "x", happiness_score: 0, date: "2026-03-01" },
    { content: "x", happiness_score: 5.5, date: "2026-03-01" },
    { content: "", happiness_score: 5, date: "2026-03-01" },
    { content: "x", happiness_score: 5, date: "March 1st" },
  ];
  for (const args of bad) {
    const result = await call(client, "create_entry", args).catch(() => ({ isError: true, text: "" }));
    assert.equal(result.isError, true, JSON.stringify(args));
  }
  assert.equal(await store.getEntry(USER, "2026-03-01"), undefined);
});

test("list_recent_entries returns newest first and honours count", async () => {
  const { client } = await connect();
  assert.match((await call(client, "list_recent_entries", {})).text, /No journal entries/);

  await seed(client);
  const two = await call(client, "list_recent_entries", { count: 2 });
  assert.ok(two.text.indexOf("2026-01-03") < two.text.indexOf("2026-01-02"));
  assert.ok(!two.text.includes("2026-01-01"));

  const all = await call(client, "list_recent_entries", {});
  assert.ok(all.text.includes("2026-01-01"));
});

test("get_entry returns the entry for a date, or an error when there is none", async () => {
  const { client } = await connect();
  await seed(client);

  const found = await call(client, "get_entry", { date: "2026-01-02" });
  assert.equal(found.isError, false);
  assert.match(found.text, /Happiness: 6\/10/);
  assert.match(found.text, /read a book/);

  const missing = await call(client, "get_entry", { date: "2025-12-31" });
  assert.equal(missing.isError, true);
  assert.match(missing.text, /No journal entry found/);
});

test("search_entries matches case-insensitively and honours limit", async () => {
  const { client } = await connect();
  await seed(client);

  const hits = await call(client, "search_entries", { query: "walk" });
  assert.match(hits.text, /Found 2 entries/);
  assert.ok(hits.text.indexOf("2026-01-03") < hits.text.indexOf("2026-01-01"));

  const one = await call(client, "search_entries", { query: "walk", limit: 1 });
  assert.match(one.text, /Found 1 entry/);

  const none = await call(client, "search_entries", { query: "skiing" });
  assert.match(none.text, /No entries found/);
});

test("get_mood_summary reports average, range and tier breakdown", async () => {
  const { client } = await connect();
  await seed(client);

  const summary = await call(client, "get_mood_summary", { start_date: "2026-01-01", end_date: "2026-01-03" });
  assert.match(summary.text, /Days with entries: 3/);
  assert.match(summary.text, /Average happiness: 6\.0\/10/);
  assert.match(summary.text, /Range: 3–9\/10/);
  assert.match(summary.text, /1–3 \(low\): 1 day\n/);
  assert.match(summary.text, /4–6 \(mid\): 1 day\n/);
  assert.match(summary.text, /7–10 \(high\): 1 day$/);

  const partial = await call(client, "get_mood_summary", { start_date: "2026-01-02", end_date: "2026-01-02" });
  assert.match(partial.text, /Days with entries: 1/);

  const empty = await call(client, "get_mood_summary", { start_date: "2025-01-01", end_date: "2025-01-31" });
  assert.match(empty.text, /No entries found/);
});

test("entries are isolated per user", async () => {
  const store = new InMemoryJournalStore();
  const alice = await connect(store, "alice");
  const bob = await connect(store, "bob");

  await call(alice.client, "create_entry", { content: "Alice only", happiness_score: 8, date: "2026-04-01" });

  assert.equal((await call(bob.client, "get_entry", { date: "2026-04-01" })).isError, true);
  assert.match((await call(bob.client, "list_recent_entries", {})).text, /No journal entries/);
  assert.match((await call(bob.client, "search_entries", { query: "Alice" })).text, /No entries found/);
});
