// Deterministic seed for the journal evals. Run: node evals/fixtures/make-seed.mjs
// Writes evals/fixtures/journal-seed.json. All entries are synthetic.
// The runner tells the agent that "today" is AS_OF.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AS_OF = "2026-09-30";
const START = "2026-04-01";
const END = "2026-09-29";

// Fixed entries the eval tasks depend on.
const anchors = {
  "2026-04-03": ["First day at the new desk. Coffee with the team lead, who walked me through the roadmap.", 7],
  "2026-05-12": ["Dentist cleaning this morning. Two small cavities, nothing scary.", 5],
  "2026-05-13": ["Called the dentist's office to book the follow-up for the cavities.", 5],
  "2026-05-27": ["Deadline crunch. Overwhelmed and on edge all day, skipped lunch.", 3],
  "2026-06-02": ["Lease renewal letter arrived. The rent goes up 6 percent and I need to decide by the end of the month.", 4],
  "2026-06-03": ["Still thinking about the lease. Talked it over with Dana, we might stay one more year.", 5],
  "2026-06-14": ["Signed up for the autumn marathon today. Eighteen weeks of training starts Monday.", 8],
  "2026-06-21": ["Birthday dinner at the little Italian place. Everyone showed up, and Dana's cake was ridiculous.", 9],
  "2026-06-25": ["Quarter-end pressure again. Nervous about the review on Friday.", 4],
  "2026-07-04": ["Quiet holiday. Barbecue on the roof, fireworks in the distance.", 7],
  "2026-07-05": ["Packed for the trip tomorrow. Passport, charger, the good camera.", 7],
  "2026-07-20": ["Back home. Jet lag is real but the trip was worth it.", 7],
  "2026-08-05": ["Rough day at the office. The demo broke twice and I felt completely out of my depth.", 3],
  "2026-08-14": ["Finally recieved the parcel I had been waiting on for weeks. New running shoes!", 8],
  "2026-08-22": ["Century ride with the cycling group, 100 km in the sun. Best day of the summer.", 10],
  "2026-09-16": ["Another week of back-to-back reviews. Feeling stretched thin and short with everyone.", 4],
  "2026-09-28": ["Monday reset. Cleaned the apartment, planned the week, early night.", 6],
  "2026-09-29": ["Quick one: walked the dog before dinner and read for an hour.", 7],
};

// Dates with no entry on purpose.
const gaps = [
  ["2026-05-20", "2026-05-26"], // a week of silence
  ["2026-07-06", "2026-07-19"], // two weeks away on a trip
];
// A full week with an entry every day.
const fullWeek = ["2026-09-21", "2026-09-27"];

// Filler text. None of these may contain the banned words checked at the bottom.
const themes = [
  { lo: 6, hi: 9, lines: [
    "Morning run along the river, legs felt light.",
    "Easy long run with the group, then pancakes.",
    "Tried a new route up the hill. Slow, but I finished it.",
    "Rest day after a hard week of training. Stretched and napped.",
  ]},
  { lo: 6, hi: 8, lines: [
    "Cooked a big pot of chili and froze half of it.",
    "Made fresh pasta from scratch. Messy kitchen, great dinner.",
    "Tried a new curry recipe. Needed more salt.",
    "Baked bread for the first time in months.",
  ]},
  { lo: 7, hi: 9, lines: [
    "Dinner with old friends. We stayed far too late talking.",
    "Board game night at Priya's place. I lost, badly.",
    "Long phone call with my sister. Good to hear her voice.",
    "Walked around the market with Dana and picked up flowers.",
  ]},
  { lo: 5, hi: 8, lines: [
    "Read most of the afternoon. The book is slow but good.",
    "Finished a chapter and fell asleep on the couch.",
    "Library trip. Came home with way too many books.",
  ]},
  { lo: 5, hi: 7, lines: [
    "Steady day at work. Cleared my inbox and fixed two small bugs.",
    "Planning meeting ran long but we landed on a clear scope.",
    "Quiet office day. Got a lot done before lunch.",
    "Code review with the new hire. She asks good questions.",
  ]},
  { lo: 3, hi: 5, lines: [
    "Slow, grey day. Not much energy for anything.",
    "Lots of small annoyances at work, nothing big.",
    "Bad sleep and a long commute. Early night.",
  ]},
  { lo: 5, hi: 6, lines: [
    "Laundry, groceries, and a pile of errands.",
    "Spent the day on chores and paperwork.",
    "Fixed the wobbly shelf and sorted the closet.",
  ]},
  { lo: 6, hi: 8, lines: [
    "Practiced guitar for an hour. The new chord change is finally clicking.",
    "Jam session with the neighbours, mostly off key and a lot of fun.",
    "Worked on the song I started last month.",
  ]},
  { lo: 6, hi: 9, lines: [
    "Walked the dog twice today. She loves the new park.",
    "Dog got into the bin again. Funny, annoying, typical.",
    "Long walk with the dog after the rain stopped.",
  ]},
  { lo: 5, hi: 8, lines: [
    "Beautiful weather, so I worked from the park for a bit.",
    "Rain all day. Stayed in and tidied up.",
    "First proper autumn chill. Wore a sweater for the first time.",
    "Windy evening on the roof, watched the clouds roll past.",
  ]},
];

const monthBias = { "04": 0, "05": -0.4, "06": 0, "07": 0.4, "08": 0.8, "09": 0.3 };

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261028);

function* dateRange(start, end) {
  const d = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  for (; d <= e; d.setUTCDate(d.getUTCDate() + 1)) yield d.toISOString().slice(0, 10);
}
const inGap = (date) => gaps.some(([a, b]) => date >= a && date <= b);
const inFullWeek = (date) => date >= fullWeek[0] && date <= fullWeek[1];

const entries = [];
let fillerIndex = 0;
for (const date of dateRange(START, END)) {
  if (anchors[date]) {
    entries.push({ date, content: anchors[date][0], happiness_score: anchors[date][1] });
    continue;
  }
  if (inGap(date)) continue;
  // Always draw so the sequence stays stable if the rules above change.
  const keep = rand();
  const themeIdx = Math.floor(rand() * themes.length);
  const t = themes[themeIdx];
  const line = t.lines[Math.floor(rand() * t.lines.length)];
  const base = t.lo + rand() * (t.hi - t.lo);
  if (!inFullWeek(date) && keep > 0.52) continue;
  const bias = monthBias[date.slice(5, 7)] ?? 0;
  const score = Math.max(1, Math.min(10, Math.round(base + bias)));
  // Coffee shows up in roughly every fourth filler entry.
  const coffee = fillerIndex % 4 === 1 ? " Coffee on the balcony first." : "";
  fillerIndex++;
  entries.push({ date, content: line + coffee, happiness_score: score });
}

// Guard rails: these words must stay rare or absent so the search tasks have known answers.
const count = (w) => entries.filter((e) => e.content.toLowerCase().includes(w)).length;
const expect = { marathon: 1, dentist: 2, lease: 2, birthday: 1, kayak: 0, stress: 0, recieved: 1 };
for (const [w, n] of Object.entries(expect)) {
  if (count(w) !== n) throw new Error(`seed word "${w}" appears ${count(w)} times, expected ${n}`);
}

const out = { as_of: AS_OF, entries };
const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, "journal-seed.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${entries.length} entries; coffee=${count("coffee")}`);
