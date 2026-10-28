// Builds evals/tasks.jsonl from the seed. Run: node evals/fixtures/make-tasks.mjs
// Ground-truth values are computed from journal-seed.json, so they cannot drift from the data.
// "truth" describes what a correct answer contains. It does not predict how the agent will fail.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(join(here, "journal-seed.json"), "utf8"));
const E = seed.entries;
const AS_OF = seed.as_of;

const between = (a, b) => E.filter((e) => e.date >= a && e.date <= b);
const avg = (xs) => (xs.reduce((t, x) => t + x, 0) / xs.length).toFixed(1);
// Mirrors get_mood_summary in src/mcp.ts.
function mood(a, b) {
  const es = between(a, b);
  if (es.length === 0) return { days: 0 };
  const s = es.map((e) => e.happiness_score);
  return { days: es.length, average: avg(s), min: Math.min(...s), max: Math.max(...s) };
}
const find = (w) => E.filter((e) => e.content.toLowerCase().includes(w)).map((e) => e.date);
const on = (d) => E.find((e) => e.date === d);

const lastWeek = ["2026-09-21", "2026-09-27"];
const aug = ["2026-08-01", "2026-08-31"];
const jul = ["2026-07-01", "2026-07-31"];
const sep = ["2026-09-01", "2026-09-29"];
const augEntries = between(...aug);
const augMax = Math.max(...augEntries.map((e) => e.happiness_score));
const months = ["04", "05", "06", "07", "08", "09"].map((m) => {
  const r = [`2026-${m}-01`, `2026-${m}-31`];
  return { month: `2026-${m}`, ...mood(...r) };
});
const bestMonth = [...months].sort((a, b) => Number(b.average) - Number(a.average))[0];

const t = [];
const add = (id, category, expected_difficulty, prompt, truth = {}, flags = {}) =>
  t.push({ id, category, expected_difficulty, prompt, ...flags, truth });

// Write
add("t01", "write", "easy", "Add a journal entry for today: went for a long walk by the water and felt calm. Happiness 8.",
  { tool: "create_entry", date: AS_OF, happiness_score: 8 }, { uses_as_of: true });
add("t02", "write", "easy", "I forgot to write on July 10th. Add an entry for that day: spent the day hiking along the coast. Score 9.",
  { tool: "create_entry", date: "2026-07-10", happiness_score: 9, existing_entry: Boolean(on("2026-07-10")) });
add("t03", "write", "medium", "Add an entry for yesterday saying I finished the book I was reading. Score 7.",
  { date: "2026-09-29", existing_entry: true, note: "The tool returns an error telling the agent to ask the user. Replacing the entry is not possible." }, { uses_as_of: true });
add("t04", "write", "medium", "Add a journal entry for today: the team shipped the release and we got pizza.",
  { note: "happiness_score is required and the prompt gives none." }, { uses_as_of: true });
add("t05", "write", "medium", "Add an entry for today: best day ever, give it an 11 out of 10.",
  { note: "The schema allows 1 to 10." }, { uses_as_of: true });
add("t30", "write", "hard", "Add an entry dated 2026-02-30: tried a new bakery downtown. Score 7.",
  { note: "February 30th is not a real date." });

// Read
add("t06", "read", "easy", "What did I write on 2026-08-14?",
  { tool: "get_entry", date: "2026-08-14", entry: on("2026-08-14") });
add("t07", "read", "easy", "What did I write on July 12th?",
  { date: "2026-07-12", existing_entry: Boolean(on("2026-07-12")) });
add("t08", "read", "easy", "Show me my last 5 entries.",
  { tool: "list_recent_entries", dates: E.slice(-5).map((e) => e.date).reverse() }, { uses_as_of: true });
add("t09", "read", "hard", "Show me everything I wrote last week.",
  { week: lastWeek, dates: between(...lastWeek).map((e) => e.date), note: "No tool lists a date range. The agent has to combine list_recent_entries or get_entry calls." }, { uses_as_of: true });
add("t29", "read", "medium", "What did I do for my birthday?",
  { search: "birthday", dates: find("birthday") });

// Search
add("t10", "search", "easy", "Find the entry where I signed up for a marathon.",
  { search: "marathon", dates: find("marathon") });
add("t11", "search", "hard", "How many times have I mentioned coffee in my journal?",
  { search: "coffee", count: find("coffee").length, note: "search_entries returns 10 results by default and 50 at most." });
add("t12", "search", "easy", "Did I ever write about kayaking?",
  { search: "kayak", dates: find("kayak") });
add("t13", "search", "hard", "When was I stressed about work?",
  { literal_matches_for_stressed: find("stress"), note: "No entry uses the word 'stress'. Entries use other words for pressure at work.", capability_gap: "keyword-only search" }, { capability_gap: true });
add("t14", "search", "medium", "Find my entries about the dentist.",
  { search: "dentist", dates: find("dentist") });

// Aggregate
add("t15", "aggregate", "easy", "What was my average mood last week?",
  { range: lastWeek, ...mood(...lastWeek) }, { uses_as_of: true });
add("t16", "aggregate", "medium", "How was my mood in August?",
  { range: aug, ...mood(...aug) });
add("t17", "aggregate", "medium", "What was my mood like in March 2026?",
  { range: ["2026-03-01", "2026-03-31"], ...mood("2026-03-01", "2026-03-31") });
add("t18", "aggregate", "hard", "Compare my mood in August to July.",
  { july: { range: jul, ...mood(...jul) }, august: { range: aug, ...mood(...aug) }, note: "July has a two-week gap while I was away." });
add("t19", "aggregate", "hard", "What was my happiest day in August, and what did I write that day?",
  { happiest: augEntries.filter((e) => e.happiness_score === augMax).map((e) => ({ date: e.date, score: e.happiness_score, content: e.content })) });
add("t20", "aggregate", "hard", "Has my mood been trending up or down over the past two months?",
  { august: mood(...aug), september: mood(...sep), note: "Past two months is August and September." }, { uses_as_of: true });
add("t28", "aggregate", "hard", "Which month was my best this year so far, and what made it good?",
  { by_month: months, best_month: bestMonth.month, note: "The journal starts in April 2026." }, { uses_as_of: true });

// Capability gaps: the server has no update or delete tool.
add("t21", "capability_gap", "easy", "Change the happiness score on yesterday's entry to 6.",
  { date: "2026-09-29", note: "No update tool exists." }, { uses_as_of: true, capability_gap: true });
add("t22", "capability_gap", "easy", "Delete my entry from Monday.",
  { date: "2026-09-28", note: "No delete tool exists." }, { uses_as_of: true, capability_gap: true });
add("t23", "capability_gap", "medium", "There's a typo in my entry from 2026-08-14. Fix 'recieved' to 'received'.",
  { date: "2026-08-14", note: "No update tool exists." }, { capability_gap: true });
add("t24", "capability_gap", "medium", "Replace my entry for yesterday with: today I finished my book, and it was great.",
  { date: "2026-09-29", note: "A second entry for the same date is rejected and there is no delete or update tool." }, { uses_as_of: true, capability_gap: true });

// Ambiguous and multi-step
add("t25", "ambiguous", "hard", "Find the entry about my lease and add a note saying I signed the renewal.",
  { search: "lease", dates: find("lease"), note: "Two entries match and there is no update tool." }, { capability_gap: true });
add("t26", "ambiguous", "hard", "Clean up my duplicate entries.",
  { note: "At most one entry exists per day, so there are no exact duplicates, and there is no delete tool." }, { capability_gap: true });
add("t27", "ambiguous", "medium", "Summarize what I've been up to lately.",
  { note: "Vague on purpose. Check the summary against the entries the agent actually retrieved." }, { uses_as_of: true });

t.sort((a, b) => a.id.localeCompare(b.id));
const out = join(here, "..", "tasks.jsonl");
writeFileSync(out, t.map((x) => JSON.stringify(x)).join("\n") + "\n");
const hard = t.filter((x) => x.expected_difficulty === "hard").length;
console.log(`wrote ${t.length} tasks (${hard} hard) to ${out}`);
