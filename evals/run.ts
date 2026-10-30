/**
 * Eval runner: runs eval tasks against the journal MCP server and writes one trace per run.
 *
 * Setup per run: a fresh InMemoryJournalStore seeded from evals/fixtures/journal-seed.json,
 * the real MCP server connected over the SDK in-memory transport (same as test/tools.test.ts),
 * and Claude driving the 5 tools in a manual agent loop.
 *
 * Usage (from the repo root, with ANTHROPIC_API_KEY set):
 *   npx tsx evals/run.ts --tasks t06,t07          run specific tasks
 *   npx tsx evals/run.ts --all                    run all tasks in tasks.jsonl
 *   npx tsx evals/run.ts --hard --runs 3          run the tasks tagged hard, 3 times each
 * Options:
 *   --runs N        runs per task (default 1)
 *   --out DIR       trace directory (default evals/traces)
 *   --force         overwrite traces that already exist
 *   --max-turns N   model calls per run before giving up (default 15)
 *
 * Output per run: <task>__run<N>.json (full trace) and <task>__run<N>.md (readable copy).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp.js";
import { InMemoryJournalStore } from "../src/journalStore.js";

// ── Pinned config (keep in sync with evals/README.md) ────────────────────────
const MODEL = "claude-sonnet-5-5";
const MAX_TOKENS = 8000;
const USER_ID = "eval-user";
// Cost is an estimate. Override with PRICE_IN_PER_MTOK / PRICE_OUT_PER_MTOK if the rates differ.
const PRICE_IN = Number(process.env.PRICE_IN_PER_MTOK ?? 3);
const PRICE_OUT = Number(process.env.PRICE_OUT_PER_MTOK ?? 15);

const here = dirname(fileURLToPath(import.meta.url));

interface Task {
  id: string;
  category: string;
  expected_difficulty: string;
  prompt: string;
  uses_as_of?: boolean;
  capability_gap?: boolean;
  truth: Record<string, unknown>;
}
interface Seed {
  as_of: string;
  entries: Array<{ date: string; content: string; happiness_score: number }>;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function systemPrompt(asOf: string): string {
  const weekday = WEEKDAYS[new Date(`${asOf}T00:00:00Z`).getUTCDay()];
  return (
    "You are a journaling assistant. You help the user read and write their private journal " +
    `using the tools provided. Today is ${weekday}, ${asOf}.`
  );
}

function parseArgs(argv: string[]) {
  const args = { tasks: [] as string[], all: false, hard: false, runs: 1, out: join(here, "traces"), force: false, maxTurns: 15 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tasks") args.tasks = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--all") args.all = true;
    else if (a === "--hard") args.hard = true;
    else if (a === "--runs") args.runs = Number(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--force") args.force = true;
    else if (a === "--max-turns") args.maxTurns = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!args.all && !args.hard && args.tasks.length === 0) throw new Error("Pass --tasks t01,t02, --hard, or --all");
  return args;
}

type Block = Record<string, any>;

async function runOnce(task: Task, seed: Seed, runIndex: number, maxTurns: number, anthropic: Anthropic) {
  // Fresh store + server per run, so runs never see each other's writes.
  const store = new InMemoryJournalStore();
  for (const e of seed.entries) {
    await store.createEntry(USER_ID, { content: e.content, happinessScore: e.happiness_score, date: e.date });
  }
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(store, USER_ID);
  const mcp = new Client({ name: "eval-runner", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), mcp.connect(clientSide)]);

  const { tools: mcpTools } = await mcp.listTools();
  const tools = mcpTools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));

  const system = systemPrompt(seed.as_of);
  const thinking = { type: "adaptive", display: "summarized" } as const;
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: task.prompt }];

  const steps: Block[] = [];
  const toolCalls: Block[] = [];
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const startedAt = new Date();
  let stopReason: string | null = null;
  let finalText = "";
  let error: string | null = null;

  try {
    for (let turn = 1; turn <= maxTurns; turn++) {
      const requestAt = new Date().toISOString();
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        tools,
        thinking: thinking as any,
        messages,
      });
      const responseAt = new Date().toISOString();
      const u = response.usage as unknown as Record<string, number | null>;
      for (const k of Object.keys(usage) as Array<keyof typeof usage>) usage[k] += u[k] ?? 0;
      stopReason = response.stop_reason;

      // Saved copy drops thinking signatures; the in-memory copy goes back to the API unchanged.
      const saved = (response.content as Block[]).map((b) => {
        if (b.type === "thinking") return { type: "thinking", thinking: b.thinking };
        return b;
      });
      steps.push({
        turn,
        request_at: requestAt,
        response_at: responseAt,
        stop_reason: response.stop_reason,
        stop_details: (response as any).stop_details ?? null,
        usage: response.usage,
        content: saved,
      });

      messages.push({ role: "assistant", content: response.content });

      const toolUses = response.content.filter((b) => b.type === "tool_use") as Anthropic.ToolUseBlock[];
      if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
        finalText = response.content
          .filter((b) => b.type === "text")
          .map((b) => (b as Anthropic.TextBlock).text)
          .join("\n");
        break;
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const t0 = Date.now();
        const startedAtTool = new Date().toISOString();
        let text: string;
        let isError = false;
        try {
          const r = await mcp.callTool({ name: tu.name, arguments: tu.input as Record<string, unknown> });
          const content = (r.content ?? []) as Array<{ type: string; text?: string }>;
          text = content.map((c) => c.text ?? "").join("\n");
          isError = r.isError === true;
        } catch (e) {
          // A protocol-level failure (for example schema validation) is a real result the agent has to handle.
          text = `Tool call failed: ${e instanceof Error ? e.message : String(e)}`;
          isError = true;
        }
        toolCalls.push({
          turn,
          tool_use_id: tu.id,
          name: tu.name,
          arguments: tu.input,
          result_text: text,
          is_error: isError,
          started_at: startedAtTool,
          duration_ms: Date.now() - t0,
        });
        results.push({ type: "tool_result", tool_use_id: tu.id, content: text, ...(isError ? { is_error: true } : {}) });
      }
      messages.push({ role: "user", content: results });

      if (turn === maxTurns) error = `Stopped at max turns (${maxTurns}) while the agent was still calling tools`;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  // What the run changed in the store, for deterministic checks later.
  const seeded = new Set(seed.entries.map((e) => e.date));
  const after = await store.listRecent(USER_ID, 1000);
  const created = after
    .filter((e) => !seeded.has(e.date))
    .map((e) => ({ date: e.date, content: e.content, happiness_score: e.happinessScore }));

  await Promise.all([mcp.close(), server.close()]).catch(() => {});

  const endedAt = new Date();
  const estimatedCost = (usage.input_tokens * PRICE_IN + usage.output_tokens * PRICE_OUT) / 1_000_000;

  return {
    trace_version: 1,
    run_id: `${task.id}__run${runIndex}`,
    task,
    run_index: runIndex,
    config: {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking,
      temperature: "unset (default)",
      system,
      as_of: seed.as_of,
      tools: tools.map((t) => t.name),
      max_turns: maxTurns,
    },
    started_at: startedAt.toISOString(),
    ended_at: endedAt.toISOString(),
    duration_ms: endedAt.getTime() - startedAt.getTime(),
    num_model_calls: steps.length,
    stop_reason: stopReason,
    error,
    final_text: finalText,
    usage_total: usage,
    estimated_cost_usd: Number(estimatedCost.toFixed(5)),
    cost_note: `Estimate at $${PRICE_IN}/$${PRICE_OUT} per million input/output tokens. Not an invoice figure.`,
    tool_calls: toolCalls,
    store_changes: { created_entries: created },
    steps,
  };
}

type Trace = Awaited<ReturnType<typeof runOnce>>;

function toMarkdown(t: Trace): string {
  const L: string[] = [];
  L.push(`# ${t.run_id}`, "");
  L.push(`**Task ${t.task.id}** (${t.task.category}, expected ${t.task.expected_difficulty})`, "");
  L.push("**Prompt**", "", `> ${t.task.prompt}`, "");
  L.push("**Expected (ground truth)**", "", "```json", JSON.stringify(t.task.truth, null, 2), "```", "");
  L.push("## What happened", "");
  for (const s of t.steps) {
    L.push(`### Model call ${s.turn} (stop: ${s.stop_reason})`, "");
    for (const b of s.content as Block[]) {
      if (b.type === "thinking" && b.thinking) L.push("_Thinking (summary):_", "", `> ${String(b.thinking).replace(/\n/g, "\n> ")}`, "");
      else if (b.type === "text") L.push(b.text, "");
      else if (b.type === "tool_use") {
        L.push(`**Tool call:** \`${b.name}\``, "", "```json", JSON.stringify(b.input), "```", "");
        const r = t.tool_calls.find((c) => c.tool_use_id === b.id);
        if (r) L.push(`**Result${r.is_error ? " (error)" : ""}:**`, "", "```", r.result_text, "```", "");
      }
    }
  }
  L.push("## Final reply", "", t.final_text || "_(none)_", "");
  L.push("## Run info", "");
  L.push(`- Model calls: ${t.num_model_calls}, tool calls: ${t.tool_calls.length}, duration: ${(t.duration_ms / 1000).toFixed(1)}s`);
  L.push(`- Tokens: ${t.usage_total.input_tokens} in, ${t.usage_total.output_tokens} out. Estimated cost: $${t.estimated_cost_usd}`);
  L.push(`- Entries created in the store: ${t.store_changes.created_entries.length}`);
  if (t.error) L.push(`- **Error:** ${t.error}`);
  L.push("");
  return L.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");

  const seed: Seed = JSON.parse(readFileSync(join(here, "fixtures", "journal-seed.json"), "utf8"));
  const allTasks: Task[] = readFileSync(join(here, "tasks.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  let selected: Task[];
  if (args.all) selected = allTasks;
  else if (args.hard) selected = allTasks.filter((t) => t.expected_difficulty === "hard");
  else {
    selected = args.tasks.map((id) => {
      const t = allTasks.find((x) => x.id === id);
      if (!t) throw new Error(`No such task: ${id}`);
      return t;
    });
  }

  mkdirSync(args.out, { recursive: true });
  const anthropic = new Anthropic();
  let totalCost = 0;
  let ran = 0;

  for (const task of selected) {
    for (let r = 1; r <= args.runs; r++) {
      const base = join(args.out, `${task.id}__run${r}`);
      if (existsSync(`${base}.json`) && !args.force) {
        console.log(`skip ${task.id} run ${r} (trace exists, use --force to overwrite)`);
        continue;
      }
      const trace = await runOnce(task, seed, r, args.maxTurns, anthropic);
      writeFileSync(`${base}.json`, JSON.stringify(trace, null, 2) + "\n");
      writeFileSync(`${base}.md`, toMarkdown(trace));
      totalCost += trace.estimated_cost_usd;
      ran++;
      const flag = trace.error ? `  ERROR: ${trace.error}` : "";
      console.log(
        `${trace.run_id}  calls=${trace.num_model_calls} tools=${trace.tool_calls.length} ` +
          `tokens=${trace.usage_total.input_tokens}/${trace.usage_total.output_tokens} ` +
          `~$${trace.estimated_cost_usd}${flag}`,
      );
    }
  }
  console.log(`\nran ${ran} runs, estimated total ~$${totalCost.toFixed(4)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
