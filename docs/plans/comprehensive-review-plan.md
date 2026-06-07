# Comprehensive Codebase Review Plan

**Date:** 2026-06-07
**Codebase:** reputation-key (947 files, ~90K LOC, 13 bounded contexts, 199 test files)
**Goal:** Exhaustive multi-round review with convergence gates, parallel agents, and persistent findings database.

---

## 1. Codebase Segmentation

### Segment Map

| Segment | Scope                       | Files                            | LOC      | Est. Review Time |
| ------- | --------------------------- | -------------------------------- | -------- | ---------------- |
| **S0**  | Global Sweep                | all src/                         | 90K      | 1 session        |
| **S1**  | Shared Infrastructure       | src/shared/                      | 6.7K     | 1 session        |
| **S2**  | Routes + Auth Guards        | src/routes/                      | 2.4K     | 0.5 session      |
| **S3**  | Components + UI             | src/components/                  | 19.8K    | 2 sessions       |
| **S4**  | Portal Context              | src/contexts/portal/             | 7.8K     | 1 session        |
| **S5**  | Goal Context                | src/contexts/goal/               | 9.6K     | 1 session        |
| **S6**  | Integration Context         | src/contexts/integration/        | 7.5K     | 1 session        |
| **S7**  | Inbox Context               | src/contexts/inbox/              | 6.9K     | 1 session        |
| **S8**  | Review Context              | src/contexts/review/             | 5.8K     | 1 session        |
| **S9**  | Identity Context            | src/contexts/identity/           | 5.0K     | 1 session        |
| **S10** | Dashboard Context           | src/contexts/dashboard/          | 3.1K     | 0.5 session      |
| **S11** | Staff Context               | src/contexts/staff/              | 3.0K     | 0.5 session      |
| **S12** | Property Context            | src/contexts/property/           | 2.9K     | 0.5 session      |
| **S13** | Guest Context               | src/contexts/guest/              | 2.7K     | 0.5 session      |
| **S14** | Team Context                | src/contexts/team/               | 2.2K     | 0.5 session      |
| **S15** | Metric Context              | src/contexts/metric/             | 1.5K     | 0.5 session      |
| **S16** | Activity Context            | src/contexts/activity/           | 1.3K     | 0.5 session      |
| **S17** | Cross-Cutting Verification  | imports, events, deps across all | 90K      | 2 sessions       |
| **S18** | Documentation Accuracy      | all CONTEXT.md, ADRs             | 18 files | 1 session        |
| **S19** | Security + Tenant Isolation | repos, server fns, handlers      | ~20K     | 2 sessions       |

**Total estimate: ~20 review sessions**

---

## 2. Findings Database

All findings stored in a single JSON file with structured schema. Enables deduplication, severity tracking, and cross-reference across parallel agents.

### Schema

```
findings/
├── db.json              # Master findings database
├── rounds/
│   ├── round-001.json   # Per-round raw output
│   ├── round-002.json
│   └── ...
└── convergence.log      # Clean-round tracker
```

### Finding record

```json
{
  "id": "F001",
  "severity": "CRITICAL|MAJOR|MINOR|NIT",
  "category": "pattern-violation|dead-code|slop|doc-discrepancy|security|tenant-isolation|missing-coverage|event-consistency|mapper-bug|auth-gap",
  "tag": "code-fix|doc-fix|needs-decision",
  "segment": "S5",
  "file": "src/contexts/goal/infrastructure/repositories/goal-repository.ts",
  "line": 142,
  "what": "UPDATE filters by id only, missing organizationId",
  "why": "Cross-tenant data mutation possible",
  "fix_direction": "Add AND organization_id = ? to WHERE clause",
  "status": "open|fixing|fixed|wontfix|deferred",
  "found_in_round": 1,
  "confirmed_in_round": [2, 3],
  "fixed_in_round": null
}
```

### db.json structure

```json
{
  "metadata": {
    "created": "2026-06-07",
    "codebase": "reputation-key",
    "total_files": 947,
    "total_loc": 90491,
    "convergence_target": 3,
    "current_consecutive_clean": 0
  },
  "rounds_completed": 0,
  "findings": [],
  "stats": {
    "by_severity": {},
    "by_category": {},
    "by_segment": {},
    "by_status": {}
  }
}
```

---

## 3. Review Phases (Sequential Gates)

Each phase has an entry gate and exit gate. You cannot proceed without passing.

### Phase A: Hygiene Sweep (S0 + S1 + S2)

**Goal:** Establish clean baseline — build passes, lint passes, tests pass, no slop.

**Entry gate:** `pnpm tsc --noEmit && pnpm lint && pnpm test` all pass (existing failures documented)

**Execution:**

1. **S0 — Global Sweep** (single agent, runs first):
   - `depcheck` for unused deps
   - Census: `as any`, `@ts-ignore`, `@ts-expect-error`, `console.log`, `TODO/FIXME/HACK`
   - Dead file sweep: files with zero imports from rest of src/
   - Verify build + lint + test baseline

2. **S1 + S2** (2 parallel agents):
   - Agent A: Shared infrastructure (auth, cache, db, events, jobs, observability)
   - Agent B: Routes + auth guards + loader patterns

**Exit gate:** Zero CRITICAL findings in S0/S1/S2. All findings logged to db.json.

---

### Phase B: Per-Context Deep Dives (S4–S16)

**Goal:** Every bounded context reviewed against its CONTEXT.md with 3 parallel agents per batch.

**Entry gate:** Phase A complete, all hygiene findings resolved or documented.

**Execution — batched by size, 3 agents per batch:**

#### Batch 1 (largest contexts — full day each):

| Agents     | Context          | LOC  |
| ---------- | ---------------- | ---- |
| 3 parallel | Portal (S4)      | 7.8K |
| 3 parallel | Goal (S5)        | 9.6K |
| 3 parallel | Integration (S6) | 7.5K |

#### Batch 2:

| Agents     | Context       | LOC  |
| ---------- | ------------- | ---- |
| 3 parallel | Inbox (S7)    | 6.9K |
| 3 parallel | Review (S8)   | 5.8K |
| 3 parallel | Identity (S9) | 5.0K |

#### Batch 3 (medium contexts — 2 contexts per batch of 3 agents):

| Agents     | Contexts                                 | LOC  |
| ---------- | ---------------------------------------- | ---- |
| 3 parallel | Dashboard + Staff (S10, S11)             | 6.1K |
| 3 parallel | Property + Guest (S12, S13)              | 5.6K |
| 3 parallel | Team + Metric + Activity (S14, S15, S16) | 5.0K |

**Per-context 3-agent pattern:**

| Subagent                 | Scope                                       | Focus                                                                                       |
| ------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Domain + Application** | domain/_, application/_, ports/\*, build.ts | Constructor validation, Result usage, permission gates, N+1, doc/code match vs CONTEXT.md   |
| **Infrastructure**       | infrastructure/_, queries/_, server/\*      | Repo tenant isolation, mapper unbrand(), event handler coverage, integration test existence |
| **Frontend**             | ui/\*, server fns, component imports        | 150-line limit, boundary imports, scroll isolation, useCallback/useMemo, dead code, a11y    |

**Each agent:**

1. Reads the context's CONTEXT.md first
2. Reads relevant ADRs (cross-reference docs/adr/)
3. Checks every file against established patterns
4. Outputs findings in standardized format
5. Parent merges + deduplicates into db.json

**Exit gate:** All CRITICAL + MAJOR findings resolved per context. Tests pass after fixes.

---

### Phase C: UI + Components Deep Dive (S3)

**Goal:** Full component audit — forms, features, layout, hooks.

**Entry gate:** Phase B complete.

**Execution — 3 parallel agents:**

| Agent | Scope                                                                         | Focus                                                                        |
| ----- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| A     | src/components/features/ (10K LOC)                                            | Component patterns, prop drilling, server fn imports, line limits, dead code |
| B     | src/components/ui/ + src/components/forms/ (5.4K)                             | Reusable component consistency, form validation, accessibility               |
| C     | src/components/layout/ + src/components/hooks/ + src/components/inbox/ (4.3K) | Layout structure, hook patterns, inbox-specific component correctness        |

**Exit gate:** Zero CRITICAL findings. All components under 150 lines. Lint passes.

---

### Phase D: Cross-Cutting + Security (S17 + S19)

**Goal:** Verify no context boundary violations, tenant isolation is airtight, event system is consistent.

**Entry gate:** Phases B + C complete.

**Execution — parent-led grep sweep + targeted delegation:**

**S17 — Cross-Cutting (parent does systematic grep, delegates deep-dives):**

1. Cross-context import violations (grep for imports into domain/ or internal-ports/ from other contexts)
2. Event consistency (4-layer check: definition → constructor → union → handler subscription)
3. Public API barrel exports completeness
4. Composition root / bootstrap wiring correctness
5. Circular dependency detection

**S19 — Security + Tenant Isolation (3 parallel agents):**
| Agent | Focus |
|-------|-------|
| A | Repository layer: every SELECT/UPDATE/DELETE includes WHERE organization_id = ? |
| B | Server functions: resolveTenantContext called, orgId from ctx not data, event handlers extract orgId |
| C | Background jobs, webhooks, OAuth callbacks, presigned URLs, cross-context API security |

**Exit gate:** Zero tenant isolation findings. Zero security CRITICALs.

---

### Phase E: Documentation Accuracy (S18)

**Goal:** Every CONTEXT.md and ADR matches actual code.

**Entry gate:** Phases A–D complete, all code fixes applied.

**Execution — dedicated doc reviewer agent:**

1. Read each CONTEXT.md
2. Cross-reference every claim against actual code
3. Check: field names, relationship claims, file listings, export completeness
4. Verify ADRs still describe current architecture
5. Update docs where code is correct and docs drifted

**Exit gate:** Zero doc-discrepancy findings.

---

## 4. Convergence Loop

After all phases complete, enter the convergence loop:

### Loop Structure

```
REPEAT:
  1. Dispatch 3 parallel subagents (different focus areas):
     - Agent A: Edge cases, runtime behavior, unchecked returns, unsafe casts
     - Agent B: Event contracts, security, data integrity, idempotency
     - Agent C: Cross-cutting, wiring, dead code, CONTEXT.md drift
  2. Each subagent reads ALL target files fresh (no anchoring)
  3. Merge findings → deduplicate → log to db.json
  4. IF findings found:
     - Fix all findings
     - Run: tsc --noEmit + lint + test
     - Reset consecutive_clean = 0
     - Go to step 1
  5. IF zero findings (all 3 agents clean):
     - consecutive_clean += 1
     - IF consecutive_clean >= 3: DONE
     - ELSE: Go to step 1
```

### Convergence targets by segment group

| Group                | Target                                            |
| -------------------- | ------------------------------------------------- |
| Per-context (S4–S16) | 3 consecutive clean rounds                        |
| Cross-cutting (S17)  | 2 consecutive clean rounds                        |
| Security (S19)       | 3 consecutive clean rounds                        |
| Documentation (S18)  | 2 consecutive clean rounds                        |
| Final convergence    | 3 consecutive clean rounds across entire codebase |

### Expected round distribution

Based on proven results from the codebase-audit skill:

| Rounds | Expected findings              |
| ------ | ------------------------------ |
| 1–3    | 20–40 per context (structural) |
| 4–6    | 5–15 (increasingly subtle)     |
| 7–10   | 1–3 (single overlooked items)  |
| 11+    | 0–1                            |

**Realistic total:** 8–15 rounds per context for convergence.

---

## 5. Parallelism Strategy

### Hermes Delegation Limits (current)

- `max_concurrent_children: 3`
- `max_spawn_depth: 1` (leaf agents only)
- `max_iterations: 50` per subagent

### Parallelism tiers

| Tier   | What runs simultaneously              | How                                        |
| ------ | ------------------------------------- | ------------------------------------------ |
| **T1** | 3 subagents (per delegate_task batch) | Built-in limit                             |
| **T2** | 3 Hermes processes via tmux           | `hermes chat -q` in background terminals   |
| **T3** | Cron jobs for long-running sweeps     | `cronjob` tool, chained via `context_from` |

### Recommended parallelism per phase

| Phase                 | Strategy                                      | Max concurrent |
| --------------------- | --------------------------------------------- | -------------- |
| Phase A (S0)          | Single agent (prerequisite)                   | 1              |
| Phase A (S1+S2)       | 2 subagents                                   | 2              |
| Phase B batches       | 3 subagents per context × 1 context at a time | 3              |
| Phase B (cross-batch) | 3 tmux agents, each reviewing 1 context       | 3              |
| Phase C               | 3 subagents                                   | 3              |
| Phase D               | Parent grep + 3 subagents                     | 3              |
| Phase E               | 1 agent                                       | 1              |
| Convergence           | 3 subagents per round                         | 3              |

### Scaling up: If you want more parallelism

**Option A: Increase max_concurrent_children** in `~/.hermes/config.yaml`:

```yaml
delegation:
  max_concurrent_children: 6 # review 2 contexts in parallel
```

**Option B: Cron-based parallel review agents:**

- Create cron jobs that each run a review of 1 context
- Use `context_from` to chain findings into a consolidation job
- Each job writes findings to the shared db.json
- Example: 6 cron jobs running simultaneously, each reviewing 1 context

**Option C: Kanban board for work distribution:**

- Create kanban tasks per segment
- Multiple worker profiles pick up tasks independently
- Workers write findings to shared file system
- Orchestrator merges + deduplicates

---

## 6. Reviewer Persona (No Mercy)

Every subagent receives this instruction:

> You are a grumpy senior code reviewer with 20+ years of experience. Call out violations bluntly. No mercy for slop, dead code, or pattern violations. If code contradicts CONTEXT.md, flag it as a finding. If a pattern is violated in one file but correct everywhere else, flag the outlier. Do NOT dismiss findings as "by design" unless you can cite the specific doc sentence that exempts it. No citation = not dismissed = not clean.

---

## 7. Pre-Flight Checklist

Before starting Phase A, run these automated checks to front-load known issues:

```bash
# 1. Brand ID mapper issues
grep -rn "\.id," src/contexts/*/infrastructure/mappers/ | grep -v unbrand

# 2. Server fn missing catchUntagged
grep -rn "throw e" src/contexts/*/server/*.ts | grep -v catchUntagged

# 3. Cross-context boundary violations
grep -rn "from.*contexts/.*/domain/" src/contexts/ | grep -v "contexts/.*/domain/" | head -30
grep -rn "from.*contexts/.*/internal-ports/" src/ | head -30

# 4. Tenant isolation
grep -rn "\.where(" src/contexts/*/infrastructure/repositories/ | grep -v organizationId | grep -v "\.where(" | head -30

# 5. Missing assert imports
grep -rn "assert(" src/contexts/*/domain/events.ts | grep -v "import assert"

# 6. catchUntagged without throw
grep -rn "catchUntagged(e)" src/ | grep -v "throw catchUntagged"

# 7. CONTEXT.md field name drift
for f in src/contexts/*/CONTEXT.md; do echo "=== $f ==="; grep -oE '[a-zA-Z]+Id\b' "$f" | sort -u; done
```

These patterns account for ~60% of repeat findings across review rounds.

---

## 8. Execution Timeline

### Conservative estimate (sequential, 3 agents per batch):

| Day       | Activity                                                                   |
| --------- | -------------------------------------------------------------------------- |
| Day 1     | Phase A: S0 Global Sweep + S1+S2 parallel                                  |
| Day 2–3   | Phase B Batch 1: Portal, Goal, Integration                                 |
| Day 4–5   | Phase B Batch 2: Inbox, Review, Identity                                   |
| Day 6     | Phase B Batch 3: Dashboard, Staff, Property, Guest, Team, Metric, Activity |
| Day 7     | Phase C: Components + UI                                                   |
| Day 8     | Phase D: Cross-cutting + Security                                          |
| Day 9     | Phase E: Documentation                                                     |
| Day 10–14 | Convergence loops (3–5 rounds)                                             |
| **Total** | **~14 days**                                                               |

### Aggressive estimate (tmux parallelism, 6+ agents):

| Day       | Activity                                     |
| --------- | -------------------------------------------- |
| Day 1     | Phase A + Phase B Batch 1 starts             |
| Day 2     | Phase B Batches 1–2 complete, Batch 3 starts |
| Day 3     | Phase B complete + Phase C + D starts        |
| Day 4     | Phases C + D + E complete                    |
| Day 5–8   | Convergence loops                            |
| **Total** | **~8 days**                                  |

---

## 9. Deliverables

1. **findings/db.json** — structured findings database with full metadata
2. **findings/convergence.log** — round-by-round clean tracking
3. **fixes applied** — all code-fix findings resolved, all doc-fix findings updated
4. **Final report** — executive summary:
   - Total findings by severity/category/segment
   - Security posture assessment
   - Tenant isolation verification
   - Documentation accuracy score
   - Convergence proof (3 consecutive clean rounds)

---

## 10. Risk Mitigation

| Risk                             | Mitigation                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------- |
| Subagent hits 50-tool-call limit | Parent does targeted grep first, delegates only focused deep-dives               |
| Subagent file output unreliable  | Use subagent summaries (returned in delegation result), parent writes report     |
| Flaky integration tests          | Re-run failing test in isolation; note as test isolation issue, not code bug     |
| False positives waste time       | Triage every finding before fixing; distinguish real bugs from design tradeoffs  |
| Context window pressure          | Each subagent gets only its segment files + CONTEXT.md, never the whole codebase |
| Regression from fixes            | Run tsc + lint + test after every fix batch; commit after each round             |
| Reviewer anchoring bias          | Each round uses fresh subagent instances, no context from prior rounds           |

---

## Appendix: How to Start

```bash
# 1. Initialize findings database
mkdir -p findings/rounds

# 2. Run pre-flight checks (Section 7)
# Fix known pattern violations before formal review starts

# 3. Begin Phase A — S0 Global Sweep
# Single agent, scans entire codebase for slop baseline

# 4. Enter phase gates as documented
```
