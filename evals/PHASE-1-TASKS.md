# Phase 1 — Evaluate the Journal MCP Server (Days 1–30)

**Target system:** this repo (ReflectAI journal MCP server)
**Goal:** publish a working eval harness with real results — a failure taxonomy derived from actual traces, a validated judge, CI integration, and one measured before/after fix.
**Budget:** ~6–8 hrs/week, ~30 hrs total.
**Done when:** the repo contains the harness, the eval set, the taxonomy, and a before/after table — and someone else could clone it and run it.

See `README.md` in this folder for the pinned config and confirmed server behavior — read it before Week 1.

Task IDs (`P1-01`) are stable. Reference them when switching between chat, Claude Code, and Cowork.

---

## Day 1 — Setup (1 hr)

- [x] **P1-01** Create branch `evals`.
- [x] **P1-02** Create the directory skeleton (`traces/`, `notes/`, `cases/`, `judge/`, `reports/`).
- [x] **P1-03** Pin model/temperature/tool set — see `README.md`.
- [x] **P1-04** Save this file to the repo so Claude Code can read and tick it off.

---

## Week 1 — Collect traces (6 hrs)

**Rule for this week: build nothing. Just watch the thing fail.**

### Write the task set

- [ ] **P1-05** Write 25–30 realistic prompts into `evals/tasks.jsonl`. Cover the whole tool surface, not just the happy path:
  - **Write:** create an entry for today; create one for a past date; create one for a date that already has an entry (must fall back to `update_entry`).
  - **Read:** fetch a specific date; fetch a date with no entry; list recent entries.
  - **Search:** a keyword that appears once; a keyword that appears in 20 entries; a keyword that appears nowhere; a *conceptual* query where the exact word never appears ("when was I stressed about work") — expected to fail, see README ground truth.
  - **Aggregate:** mood summary for a week, a month, a range with gaps, a range with zero entries.
  - **Mutate:** update content only; update score only; update a nonexistent entry; create without a happiness score (required field — does the agent ask or guess?).
  - **Destructive:** delete an entry; try to get the agent to delete without you confirming first (tests the *agent's* behavior — the server already enforces `confirm: "DELETE"`, see README); delete a date that doesn't exist.
  - **Ambiguous / multi-step:** "how was last month compared to the one before"; "find that entry about the condo thing and add a note to it"; "clean up my duplicate entries."
- [ ] **P1-06** Seed a test journal with 60–100 entries spanning several months, with deliberate gaps and a few near-duplicate topics. Real-ish data or the eval is theatre.
- [ ] **P1-07** Tag each task with `expected_difficulty` (easy/medium/hard) — you'll want this later to see whether failures cluster.

### Run and capture

- [ ] **P1-08** Write `evals/run.ts` that runs one task end-to-end and writes a trace file: the prompt, every tool call with arguments, every tool result, the final response, timestamps, token counts.
- [ ] **P1-09** Run all 25–30 tasks. Save every trace to `evals/traces/`.
- [ ] **P1-10** Run the 8–10 hardest tasks **three times each**. Non-determinism is the whole reason evals exist — you need to see the spread, not one sample.
- [ ] **P1-11** Sanity-check that traces are complete and readable. If you can't tell from a trace file what happened, fix the logging now, not in week 3.

**Week 1 done when:** ~50 trace files exist and you have read none of them systematically yet.

---

## Week 2 — Error analysis (7 hrs)

**This is the highest-value week and the one everyone skips. Do not skip it.**

### Open coding

- [ ] **P1-12** Read every trace, one at a time. For each, write one or two sentences of free text in `evals/notes/` describing what went wrong — or "fine" if nothing did.
  - **No categories in advance.** Don't bring a list of expected failure modes and tick boxes. The point is to discover what actually breaks, which is reliably different from what you predicted.
  - **Don't delegate this.** You are the domain expert on your own journal. This is the one step where doing it by hand *is* the deliverable.
- [ ] **P1-13** Note failures at every layer, not just the model's final answer: wrong tool chosen, right tool with wrong arguments, tool returned something surprising, model mishandled a correct result, model was right but unverifiable from the output.
- [ ] **P1-14** Flag anything where **you** couldn't tell whether it was right without checking the database. Those are "product smell" cases — outputs the user can't verify. They're a product finding, not just an eval finding.

### Build the taxonomy

- [ ] **P1-15** Cluster your notes into categories. Expect 5–8. Merge anything with fewer than 2 instances into a neighbour or an "other" bucket.
- [ ] **P1-16** Write `evals/reports/failure-taxonomy.md`: name each category, define it in one line, give 2 real trace excerpts, and record the count and rate.
- [ ] **P1-17** Rank categories by **frequency × severity**. Severity is your judgment call: silently wrong beats visibly broken; irreversible beats recoverable.
- [ ] **P1-18** Write down your prediction: which category will be hardest to fix, and why. You'll check this in week 4.

**Week 2 done when:** you can name the top failure mode and its rate out loud without opening the file.

---

## Week 3 — Build the harness (8 hrs)

### Eval cases

- [ ] **P1-19** Write 30–50 cases into `evals/cases/`, allocated in proportion to the taxonomy — more cases for the failure modes that actually occur.
- [ ] **P1-20** Split into two kinds and label each case:
  - **Deterministic checks** — did it call `get_entry` with the right date; did it refuse to delete without confirmation; did the mood average match a computed value. Assert these in code. Cheap, fast, no judge needed.
  - **Open-ended judgments** — was the search result actually relevant; was the summary faithful to the entries; was the refusal explained usefully.
- [ ] **P1-21** Push as much as possible into the deterministic bucket. Every case you can assert in code is a case you don't have to pay a judge to grade or validate.

### The judge

- [ ] **P1-22** Write a judge prompt for the open-ended cases. Binary pass/fail with a required one-line reason. Avoid 1–5 scales — they produce mush and inter-rater disagreement you can't act on.
- [ ] **P1-23** Hand-label 20 open-ended cases yourself first. Save to `evals/judge/gold-labels.jsonl`.
- [ ] **P1-24** Run the judge against those 20. Measure agreement with your labels.
- [ ] **P1-25** Iterate the judge prompt until agreement is ≥90%. Log each iteration and its score in `evals/judge/alignment-log.md` — this log is portfolio evidence, not scratch work.
- [ ] **P1-26** If agreement plateaus below 90%, the criterion is probably ambiguous, not the judge. Rewrite the criterion.

### Automate

- [ ] **P1-27** Write `evals/report.ts` — runs everything, emits pass rates overall and per failure category, and writes a markdown report.
- [ ] **P1-28** Add `.github/workflows/agent-evals.yml`. Trigger on changes to the server's tool definitions (`src/`), plus a nightly cron.
- [ ] **P1-29** Set `ANTHROPIC_API_KEY` as a repo secret. Cap the run cost — nightly evals on a personal repo can quietly get expensive.
- [ ] **P1-30** Commit the **baseline** report. This is the number you'll beat.

**Week 3 done when:** CI runs green on a push and produces a report you didn't have to assemble by hand.

---

## Week 4 — Fix, measure, publish (7 hrs)

### Fix one thing

- [ ] **P1-31** Take the #1 ranked failure mode. Write a one-paragraph hypothesis about the cause *before* changing anything.
- [ ] **P1-32** Make the smallest change that tests the hypothesis — tool description, system prompt, argument schema, or a new tool. Change one thing at a time.
- [ ] **P1-33** Re-run the full suite. Record the new numbers.
- [ ] **P1-34** Check for regressions in the other categories. A fix that moves one number up and two down is a finding worth writing about.
- [ ] **P1-35** If the fix failed, keep it in the report. A documented failed hypothesis is more credible than a clean success story, and it's rarer.

### Publish

- [ ] **P1-36** Write `evals/reports/phase-1-results.md`: what the agent does and how you tested it; the failure taxonomy with rates; judge alignment methodology and score; the fix, the hypothesis, before/after table; what surprised you; what you'd do differently.
- [ ] **P1-37** Rewrite the repo README so a stranger understands in 30 seconds what this is and why it exists.
- [ ] **P1-38** Merge `evals` to main.
- [ ] **P1-39** Write build log #1 — working title: *"I evaluated my own agent and it was worse than I thought."* Lead with the number that surprised you.
- [ ] **P1-40** Post it. Link the repo.

### Close out

- [ ] **P1-41** Check your P1-18 prediction against what actually happened. One paragraph, in the report.
- [ ] **P1-42** Note which parts of the harness are reusable for Phase 2 (adversarial permission cases will reuse the runner, the trace format, and the judge scaffolding).
- [ ] **P1-43** Day 30 checkpoint: if you're past day 40, cut Phase 3 (retrieval) rather than compressing Phase 2 (governance). Governance is the differentiator.

---

## Guardrails for the whole phase

- **Don't build the harness before doing the error analysis.** A harness built from imagination tests the failures you guessed, and those aren't the real ones.
- **Ship the broken parts.** The failures are the credibility; a portfolio piece with a 100% pass rate reads as a weak eval, not a strong agent.
- **One config, pinned.** If the model or tool set changes mid-phase, your before/after is worthless.
- **Time-box week 1.** The temptation is to keep generating tasks. Thirty is enough.
