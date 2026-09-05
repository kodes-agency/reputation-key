# RepKey lean audit — 5 September 2026

**Subject:** `rep-key` at `f3d9baac`, three days and 42 commits after the [2 September state-of-the-app review](../2026-09-02-state-of-the-app/README.md).
**Question:** what do we delete so one developer can build and run this?
**Method:** eight parallel audits — [architecture](ARCH.md), [database](DATA.md), [CI and release](CI.md), [tests](TEST.md), [ADRs and docs](ADR.md), [security](SEC.md), [frontend](UI.md), [dependencies and build](DEPS.md) — each told to build on the September review rather than repeat it, to treat every ADR as a claim rather than a fact, and to rank deletions by value per effort. Every figure was measured on this commit with `wc`, `grep`, `git log`, `gh`, live Railway readback and two local production builds. Where two audits disagreed, the disagreement is stated and resolved here rather than averaged away.

Published page: https://claude.ai/code/artifact/e3599e80-ba39-4b03-9881-13808b270ab8
Companion service map: https://claude.ai/code/artifact/5f75cb2f-3d5e-46fa-98ca-0edc2f78f72a

---

## 1. Verdict

Yes, it can be radically simplified, and the shape of the problem is the same in all eight dimensions. **The rules are mostly right. The machinery around them is the cost.** Google's written response imposes content-handling rules — PII removal, a 30-day cache, manual publish, opt-in — and every one of those survives intact. What goes is what RepKey imposed on itself: sidecar topology, signing ceremonies for one signer, catalogues that mirror code, tests that assert prose, two-person rules in a one-person team, and 236 database tables of which 54% exist for no product reason.

Roughly **200,000 to 250,000 lines of TypeScript** (about 30% of the total), **3 million lines of generated JSON**, and 182 migration files can go without a customer noticing anything except faster pages. The first two weeks remove every active harm and about a third of the ceremony. The full plan is about three months of focused solo work, and it is front-loaded.

Two things first. **Eight real defects were found that hurt the one customer today**, independent of any simplification; most take minutes. And a governance gate built to "prove supply-chain reproducibility" has blocked every security patch since 21 August.

## 2. Where it is, where it can be

| Measure                                 |                    Now |  Lean target | What closes the gap                                                                       |
| --------------------------------------- | ---------------------: | -----------: | ----------------------------------------------------------------------------------------- |
| Railway services                        |                     12 |            5 | Collapse five sidecars into web/worker; delete two test fakes                             |
| Dockerfiles / build configs             |           10 / 12 tsup |        1 / 1 | One image, two start commands; one `defineConfig([])`                                     |
| Database tables                         |                    238 |          ~80 | Drop governance (51), AI ceremony (20), data-cell (6), legacy (38), most plumbing (14)    |
| DB functions / triggers                 |              115 / 141 |    ~10 / ~10 | Only 35 functions are called from app code; 103 triggers guard rows the app itself writes |
| Migration files / snapshot JSON         |            182 / 91 MB |   2 / 1.5 MB | Squash to one baseline; one production DB, one row to reset                               |
| Production TypeScript                   |             380k lines |        ~250k | Services, release, governance, region, legacy, bus, ports                                 |
| Test TypeScript                         |             325k lines |        ~200k | Harness, catalogue, prose and mock-DB tests; sidecar tests                                |
| Unit test wall, local                   |                  616 s |       <120 s | 13% of test lines take 77% of execution; delete them                                      |
| PR CI wall                              |               12.4 min |       ≤7 min | e2e is 12.3 of the 12.4; move broad e2e nightly, keep 7 journeys on main                  |
| Governance code                         |           23,286 lines |       ~1,000 | Keep `capability-fate.ts` and make the runtime read it; delete mirrors                    |
| Release scripts / IaC                   |         18,666 / 1,952 |       ~0 / 0 | Digest deploy already built this week; delete what it replaced                            |
| Release-images workflow runs, ever      |                      0 |            — | Delete the workflow                                                                       |
| npm scripts                             |                    175 |           24 | 24 have zero references anywhere; 70 are `ops:`/`release:`                                |
| ADRs                                    |                     49 |           24 | 13 keep, 11 amend, 13 merge, 12 retire                                                    |
| Active docs                             |  167 files / 33k lines |    ~55 / ~9k | Archive July/August programs; one-page `BETA.md` as authority                             |
| Bounded contexts                        |                     17 |          ~11 | Delete 3 dark; merge metric+goal+dashboard, activity+notification, staff→identity         |
| Port interfaces with one implementation |               51 of 85 |       inline | Delete the `.port.ts`, export the adapter's type                                          |
| First-load JavaScript, every page       |             ~650 KB gz |      <200 KB | React is inside the charts chunk; the budget gate measures one file                       |
| Local stack                             | 26 containers / 109 GB | 2 containers | Postgres + Redis; app on the host                                                         |

## 3. Fix before anything else — eight defects, about one day

These hurt the customer now and have nothing to do with simplification. None needs the sidecar collapse. Two need a Railway change — ask before mutating.

1. **Backups are off and a restore was never proven.** Notes from 29 August record PITR as disabled; nothing since verifies it. `scripts/ops/restore-verify.ts:27-49` never calls the resurrection fence; `backup-erasure-ledger.ts:245-257` reads the ledger from the database being restored. _Fix:_ enable Railway Postgres backups; run one restore into a sibling database; export the ledger first. Minutes + half a day.
2. **Two public internet proxies, not one.** Postgres `altaria.proxy.rlwy.net:16530` (flagged in September) and — newly found — the job-queue Redis at `:15444`. Job payloads carry review identifiers. `docs/operations/capability-state-2026-09-02.md:165` says no proxy exists; `closed-beta-google-content-activate.ts:204` calls it temporary. _Fix:_ remove both; use `railway connect`. 10 minutes.
3. **Nobody is paged.** No `SENTRY_DSN`, no `ALERT_WEBHOOK_URL`. `alert-dispatcher.ts:39-46` sends only if the webhook exists. Platform showed green with `jobs.ready=false` and 19 dead letters. _Fix:_ set both; alert on `jobs.ready=false`, dead letters > 0, policy-deny spikes (`alert-aux-reads.ts:83-98` already computes them). Hours.
4. **Security patches blocked since 21 August.** 20 of 20 Dependabot runs fail; 37 of 60 PRs died unmerged. Three authorities demand exact versions: `scripts/ci/check-technology-stack.ts` (1,009 lines), `security/technology-stack.json`, and `src/shared/ai-canonicalizer-attestations.test.ts:52-65` pinning `openai: '7.4.0'`. _Fix:_ delete all three; keep the lockfile and `check:dependency-audit`. Half a day.
5. **Every page ships ~650 KB gz of JavaScript; the gate says 114.** `scripts/check-bundle-budget.mjs:57-72` sizes one file and labels `vendor-charts` lazy; that chunk contains `react-dom`. Static closure of the entry: 171 chunks, 628,719 B. `inbox/index.tsx:6` imports the search schema through `inbox-page-v2.tsx`, dragging 86 files into the initial graph. _Fix:_ a `vendor-react` group in `vite.config.ts:396-400`; import the schema from its own module; make the budget script measure the closure. Half a day.
6. **The portal hero-image job cannot run in production.** `sharp` is a devDependency loaded at runtime (`process-image.job.ts:61`); `Dockerfile:109` installs `--prod`. _Fix:_ move `sharp` and `@sentry/tanstackstart-react` to `dependencies`. 15 minutes.
7. **The AI notice promises one hour; the system keeps 24.** `merchant-ai-notice-contract.ts:93,95` says "at most one hour"; `ai-openai-request-contract.ts:20` sets `prompt_cache_retention: '24h'` on global `api.openai.com` with `zeroDataRetentionClaim: 'none'`. _Fix:_ set `in_memory`, or correct the notice and re-consent; rewrite `docs/design/regional-data-flow-map.md`.
8. **Two unauthenticated test fakes in the production project** — `gbp-sandbox`, `mail-sandbox`. _Fix:_ delete. 5 minutes.

## 4. The pattern, in five shapes

**Self-imposed conditions laundered as obligations.** ADR 0050 grants RepKey an exception to its own rule, then attaches conditions to that exception — dedicated sidecars, five signed role documents, a RAM-only Redis — and every later document cites those conditions as "required". Nobody outside RepKey asked for any of it. Also: the "controlled contraction" gate keeping 38 dead tables alive (dropping four empty ones cost 62 files and 44,094 lines, `313302b6`); ADR 0059 binding a canary profile to its own file's hash.

**Catalogues that mirror code.** The most-changed file in the repository over 60 days is `src/shared/governance/entry-point-catalogue.ts`: 116 edits, more than `composition.ts` or `package.json`. `capability-fate.ts`, which the September review called "the best artifact in the repository", has one production importer (error text); the runtime decides from `beta-capabilities.ts` 500 lines away. `technology-stack.json` mirrors `package.json`. 4,741 lines of CONTEXT.md tables mirror `build.ts`.

**Two-person rules in a one-person team.** Gate F needs six approval roles; zero are enrolled, including `founder`. `live-evidence/common.ts:122-131` requires capturer ≠ attester. Legal documents may only be approved by external counsel, who is `not_enrolled`. Five Ed25519 role documents signed per release by one person holding all five keys.

**Controls that caught nothing and caused outages.** Google approval bundles: four outages (`41e44983`, `c1f65021`, `1b83c485`, `32536428`), zero catches. Release-identity coupling: one failed deploy and a crashed worker (`20328977`). Sidecar hop failures: 1, 2 and 5 September. The 24-hour canary window: never observed. The AI canary gate: exercisable only by taking AI down (ADR 0051).

**Tests of prose and of the laptop.** Four `adr-*-presence.test.ts` files assert English in markdown. 37 test files read `docs/`. `pinned-runtime.test.ts:132` fails on any Node but 22.23.2; 153 files hard-code that version. `one-container-per-process.test.ts` spends 155 s spawning five child processes to prove eight facts about a topology being deleted. Governance and harness tests: 13% of test lines, 77% of unit execution.

**The 150-line rule that manufactured files.** 273 of 452 production component files are under 100 lines. The Google import wizard: 35 files, six hooks, for an action each property performs once. `reply-editor.tsx` (48 lines) exists to rename one prop. Backend equivalent: 139 port files, 51 of 85 interfaces with one implementation, 16 files to touch for `review.reply.published`.

## 5. What must survive

| Obligation or control                                                  | Imposed by        | Where it lives                                                        | Status                                            |
| ---------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------- | ------------------------------------------------- |
| Per-property AI analysis; no cross-property aggregation                | Google            | worker prompt builders                                                | Stays as a rule                                   |
| Raw review content refreshed or removed within 30 days                 | Google            | `review/domain/rules.ts:16`, `content_expires_at`                     | Stays as-is                                       |
| PII removed before any text reaches the AI provider                    | Google            | `ai-review-source-contract.ts:348` — one call site                    | Stays; pin with a test after the collapse         |
| Provider does not train; retention minimised                           | Google            | OpenAI project setting + `store:false`                                | Fix the 24-hour cache (defect 7)                  |
| Merchant opt-in before AI; manual publish of every reply               | Google            | `execution-policy.ts:390-413`; `no-auto-publish.test.ts`              | Stays as-is                                       |
| OAuth web-server flow; tokens encrypted at rest                        | Google / OAuth    | `oauth-state-handle.ts`; `token-encryption.adapter.ts`                | Simplify to one keyring; add a key-version prefix |
| No review gating on the guest portal                                   | Google            | ADR 0044; `guest/server/public.ts`                                    | Stays                                             |
| Accurate privacy notice before onboarding a third party                | GDPR              | `docs/legal/*.md`                                                     | Keep documents; drop the registry machinery       |
| Sessions, CSRF, tenant isolation, rate limiting, headers, guest tokens | RepKey, and right | `auth.ts`, `tenant-resolver.ts`, `rate-limit/`, `security-headers.ts` | Stay; one duplicate auth limiter goes             |
| Outbox: durable identifier-only facts, atomic with state               | RepKey, and right | ADR 0030; `outbox_events`                                             | Stays; the in-process bus beside it goes          |
| Injectable clock; server-only import protection; context boundaries    | RepKey, and right | ADR 0017, 0015, 0008 rule 3                                           | Stay                                              |

**Six tests to write before the sidecar collapse** (see [SEC.md](SEC.md) § Post-collapse invariants): exactly one module imports `openai`, worker-only; the provider client accepts only the branded canonical source; `OPENAI_API_KEY` absent from the web env schema; no `fetch` to `googleapis.com` outside the typed adapter and the direct-fetch fallback at `provider-config-guards.ts:14-19` deleted; spend cap at the OpenAI project level, recorded; `ENCRYPTION_KEY` carries a version prefix.

## 6. The ADRs, judged

Full per-record reasoning in [ADR.md](ADR.md).

| Verdict | Count | Records                                                                                                                           |
| ------- | ----: | --------------------------------------------------------------------------------------------------------------------------------- |
| Keep    |    13 | 0008 0015 0016 0017 0030 0031 (flip to accepted) 0040 0041 0046 0052 0055 0056 (+0051 until the collapse)                         |
| Amend   |    11 | 0007 0019 0032 0033 0038 0042 0044 0049 0050 0053 0057                                                                            |
| Merge   |    13 | 0003→0055 0004→0055 0006→0052 0010→0056 0011→0046 0012→0015 0013→0052 0018→0019 0022→0046 0039→0052 0045→0056 0047→0032 0054→0057 |
| Retire  |    12 | 0001 0002 0005 0009 0014 0020 0021 0043 0048 0058 0059 0060                                                                       |

ADR 0050 loses ~300 of 407 lines: §3/§5/§7/§10 (the Google contract) stay verbatim; §11 role bindings (caused the 31 August boot refusal) and §12 topology go.

**One disagreement, resolved.** The CI audit retires ADR 0051; the ADR audit keeps it. Both are right at different times: keep it until the collapse lands, then fold its one surviving rule into the release checklist. Keep the two-Redis split (ADR 0053): enforced in code, costs nothing, removing it is work for no gain.

## 7. The plan, in five phases

### Phase 0 — Stop the bleeding (this week, 2–3 days)

1. The eight defects above.
2. Delete 24 npm scripts with zero references, six dead devDependencies (`@vitest/coverage-istanbul`, `@types/sharp`, `eslint-import-resolver-typescript`, `shadcn`, `dotenv-cli`, `concurrently`), `findings/`, `better-auth_migrations/`, `tsconfig.node.json`, `security/audit-exceptions.json`. 1 h.
3. Prune `drizzle/meta` to `_journal.json` + latest snapshot. 124 files, 90 MB tracked and copied into every image (`Dockerfile:164`); only `_journal.json` is read (`readiness.ts:59`). 30 min.
4. Delete 597,000 lines of raw evidence JSON from `docs/release-evidence`; keep the markdown. 30 min.
5. One Docker image: delete `Dockerfile.worker`; worker uses the web image with a `startCommand` (`Dockerfile:157-158` already ships `dist-worker`). 1 h.
6. Turn off `strict` branch protection; drop CodeQL and Fallow from required contexts (they go nightly). 10 min.

### Phase 1 — Replace the authority, delete the dead (weeks 1–2)

1. **Write `docs/BETA.md`** (≤120 lines; outline in [ADR.md](ADR.md)): what the beta is, the external obligations, the product contract from §3 of the program, the capability table, enforced architecture rules, a release checklist replacing Gate F. Repoint `documentation-authority.test.ts:9-17`. Archive the 1,470-line program and both completion plans in the same commit. 1 day.
2. **Delete `team`, `badge`, `leaderboard` outright.** Builds are already empty (`team/build.ts:9-16`). `pg_dump` 17 tables, drop in one migration, remove 91 governance mentions, the `badge.awarded` notification wiring, three ops scripts; retire ADRs 0013/0014/0021/0043. 1–2 days.
3. **Squash the migration journal** to one baseline plus one functions file; reset `drizzle.__drizzle_migrations` under the existing deploy lock (`migrate-deploy.ts:23-27`). Drops 182 files, `drizzle.bak`, 12 orphan `scripts/migrations/*.sql`, two hard-coded special cases in `staged-drizzle-migrator.ts`. Backup first. 1 day.
4. **Delete governance/harness tests** to a keep-list of ≤12 canaries (`tenant-predicate-canary`, `no-auto-publish`, `atomic-*-outbox`, `privacy-exfiltration-canary`, `content-free-facts`, `guest-contact-containment`, `retired-*`, `capability-fate.test.ts`). Remove the `test-unit-coverage` second full run. ~19,000 lines, ~135 s. 1–2 days.
5. **Delete governance code with no production importer**: `context-standards-*`, `context-public-interface-authority`, `counsel-decision-checklist`, legal registry trio, `operator-command-mutation-classifier`, `gate-policy.ts`, `infrastructure-factory-style-authority`, four `adr-*-presence` tests. Derive `CORE_CAPABILITIES`/`BLOCKED_CAPABILITIES` from `capability-fate.ts`. 2 days.
6. **Frontend dark surfaces**: Staff shell (~1,900 lines; refuse role-less members at `_authenticated.tsx:112`), legacy redirects, `/register`, `/` landing, Closure Center (1,380), hero-image upload for a blocked capability, the 2FA card. 1 day.
7. **Write the six invariant tests.** 1 day.

### Phase 2 — Collapse the topology and its ceremony (weeks 3–7)

1. **Google trio into the worker** (~2 weeks). Allowlist, permits, quota as modules; delete the direct-fetch fallback; grants and OAuth state in the existing Redis with 15-min TTL.
2. **Delete the Google approval-bundle stack** (~5,300 lines; `google-content-approval.ts`, `google-content-authority.ts`, sign/activate tooling, `capability-refusal.ts`). Replace with a per-property enabled row + route-catalogue version compare. Retire ADR 0050 §11. 2–3 days.
3. **AI pair into the worker only** (~2 weeks). Reply drafting becomes a job; hard spend cap at OpenAI; rotate the key; delete settlement receipts, canary authorization, ~10 of 13 keyrings, `internal-mtls.ts` (952 lines).
4. **Delete the release machinery the digest deploy replaced**: `release-images.yml` (0 runs), Gate F, `live-evidence/`, canary window, legal approval, `deploy-beta.ts`, `.railway/`, data-cell tooling. `scripts/release` 18,666 → ~0; `src/shared/release` 17,877 → ~1,500. `deploy-ci-images.ts` from nine flags to two. 3–4 days.
5. **CI to the lean shape.** PR: `static`, unit shards, integration, artifacts, two Docker images, secrets — ≤7 min. Main: + 7 critical e2e journeys (retry once, no `--fail-on-flaky-tests`) + digest push. Nightly: broad e2e, Storybook, CodeQL, Fallow, simulation, licences. 1 day.
6. **Drop the sidecar build surface**: 7 Dockerfiles, 10 tsup configs, 6 `railway.*.json`, the sidecar docker matrix (`ci.yml:447-455,567-640`), four bundle verifiers, `check:container-images` (728 lines). 1 day.

### Phase 3 — Shrink the product code to six properties (weeks 7–12)

1. **Delete the in-process event bus** (`event-bus.ts`, `emit-and-record.ts`, `cutover-flags.ts`, `shadow-compare.ts`, all `event-handlers/` dirs; ~4,100 lines / 72 files). Durable consumers already exist for all 39 event types. Write review→inbox and portal→metric projections in the source transaction. 4–5 days.
2. **Delete region/data-cell machinery** (12,900 lines, 15 `*_topology_cutover_fence` triggers, `single-us-data-cell-cutover.ts`, `region-move*`). Also removes the "non-US property vanishes" failure mode. 2 days.
3. **Schema to ~80 tables** ("RepKey-80"): AI ceremony (20 tables, ~50 functions, ~8,000 lines PL/pgSQL), org lifecycle/privacy/backup receipts (12), policy tables to config (5), metric registry to constants (4), 103 immutability triggers and 57 guard functions, plumbing receipts (14). 2–3 weeks, bucket by bucket.
4. **Merge contexts**: metric+goal+dashboard → `reporting`; activity+notification → `feed`; staff → identity `people`. Delete the three legacy goal families (3,039 lines, 6 tables). 2 weeks.
5. **Tests to the lean pyramid**: 19 mock-DB store twins (10,968 lines), 32 org-lifecycle unit twins (8,212), beta-acceptance harness, `pinned-runtime.test.ts`; `pnpm test` = `--project=unit`, under 2 min. 3 days.
6. **Frontend**: one `Stat` primitive; `<input type="color">` for 1,638 lines; inbox to one hook + one editor; collapse the import wizard; one Storybook runner, no `addon-mcp`/`addon-vitest`; component cap 150 → 300. 1 week.
7. **Local stack** to ~60-line compose (Postgres + Redis), app on host; `stack.ts` 2,703 → 0; `compose.local.yml` 1,077 → 60; reclaim 109 GB. 1 day.

### Phase 4 — Keep it small (ongoing)

- Inline single-implementation ports as contexts are touched (toward −8,000 of 12,927 lines).
- ADR cut per §6; generate the index from frontmatter; cap CONTEXT.md at ~80 lines, delete mirror tables.
- Docs to ~55 active files; move Google's letter to `docs/external/google/` — it currently sits in a folder titled "Historical program index".
- ESLint boundaries 1,300 → ~150 lines; Node pin exact only in the Dockerfile.

## 8. What is honestly lost

- **The OpenAI key lives in the worker.** The worker already holds the Google tokens (rated P0 in ADR 0038). The key adds bounded spend plus one privacy exposure if redaction regressed; the type-level pin and the spend cap answer it. Low-to-moderate.
- **Redaction and the route allowlist become code paths, not process refusals.** The process refusal was already bypassable via the direct-fetch fallback that exists today. An import-boundary test is the honest form of the same guarantee.
- **A real network egress boundary will be needed before open beta.** ADR 0050 is right about that and right that Railway cannot provide one. A deferral; `BETA.md` should say so.
- **Database immutability guards go.** They protect against hand-typed SQL by the one person who wrote them.
- **Same-PR cross-browser/a11y feedback moves nightly.** In 40 runs: one flake, zero cross-browser defects.
- **Rollback to models nobody ran.** Git and one `pg_dump` keep them.
- **The approval audit trail.** Git author on the digest-bump commit is the same record. Re-add a countersign field if a second person joins.
- **The codebase stays large.** This removes ~30% of TypeScript and nearly all generated JSON. The product contexts remain substantial for six properties; a second pass becomes possible only once the machinery is gone.

## 9. Why this happened, and why the trend is already turning

Sixty days: 1.66M lines added, 192k deleted (12%); 306 fixes to 240 features. Since 2 September: deletion ratio 53%, and `4085491e` ("delete what nothing reads") executed a large slice of the review in one day. The direction is right. The fix-to-feature ratio has worsened to 22:6 in the same window because the remaining machinery still generates the fixes.

The shape that produced this is planning for open-beta scale, Google-compliance-grade isolation and a multi-person release process before having the customers, the platform or the people those things are for. Every piece has a written rationale. The rationale was written by RepKey for a future RepKey, and the present one pays for it in the only currency a solo operator cannot spare.

---

## 10. Index

| File               | Dimension                     | One-line headline                                                                                                     |
| ------------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [ARCH.md](ARCH.md) | Architecture & contexts       | 51 of 85 ports have one implementation; the in-process bus duplicates the outbox; delete team/badge/leaderboard first |
| [DATA.md](DATA.md) | Database                      | 54% of 238 tables self-imposed; 35 of 115 functions called; squash the journal first                                  |
| [CI.md](CI.md)     | CI, gates & release           | Dependabot 20/20 failing on a self-imposed pin; release workflow 0 runs ever; PR 12.4 min of which e2e 12.3           |
| [TEST.md](TEST.md) | Tests                         | 13% of test lines = 77% of execution; main red half the time, never from unit tests                                   |
| [ADR.md](ADR.md)   | ADRs, governance & docs       | 13 keep / 11 amend / 13 merge / 12 retire; write `BETA.md` first                                                      |
| [SEC.md](SEC.md)   | Security                      | Every real control survives; ceremonial ones caused four outages; two public proxies; backups off                     |
| [UI.md](UI.md)     | Frontend & routes             | ~650 KB gz on every page while the gate says 114; Staff shell for a role nobody can hold                              |
| [DEPS.md](DEPS.md) | Dependencies, build & tooling | `sharp` missing in prod; 91 MB of snapshots per image; 175 scripts → 24                                               |
