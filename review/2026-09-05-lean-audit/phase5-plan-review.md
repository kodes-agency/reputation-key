# Review of `LEAN_TRANSFORMATION_PLAN.md` against `origin/main` = `6738e364`

44 headings. **31 sections hold clean, 13 carry failures.** Classifications: `stale` = true when written, superseded; `wrong` = never true / never executed with no note; `record-only` = a number the plan asked to record that was never recorded.

---

## §1 `# Lean transformation` (L1) — 0 claims, heading only

## §2 `## Context` (L3-21) — 14 claims checked, 3 fail

| line | claim                                                                                                                                                                                        | command / evidence                                                                                                                                                                                                                                                                                                                                                                | class                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| L11  | "the fence in `scripts/check-test-quality.mjs` retires ~146 governed AI-language tests and **the suite still exits 0**. **Until WP1.2 deletes the fence**, every gate runs under `fnm use`." | `grep 'PINNED_RUNTIME\|RUNTIME_DRIFT\|runtimeFence' scripts/check-test-quality.mjs` → `PINNED_RUNTIME` :86, `RUNTIME_DRIFT` :91, five `runtimeFence: true` (:124,133,142,151,160), drift branch :264-284. WP1.2 never deleted it. The `~146` still holds exactly (79+38+21+7+1). But the branch now `failures.push(...)` unless `ALLOW_RUNTIME_DRIFT=1` — it does **not** exit 0. | `wrong` (deletion promise) + `stale` (behaviour) |
| L13  | End state: "`drizzle/` holds exactly **two** files"                                                                                                                                          | `ls drizzle` → `0000_baseline.sql 0001_db_constructs.sql 0002_db_seed.sql` + `meta/`. WP1.3's execution note adds the seed file and the Program rules (L30) say three.                                                                                                                                                                                                            | `stale` — corrected in WP1.3, not here           |
| L13  | End state: "`pnpm test` is the unit project only"                                                                                                                                            | `package.json` has no `test` script (53 scripts, none named `test`). WP4.2 #477 cut 98→53.                                                                                                                                                                                                                                                                                        | `stale`                                          |

Holds: audit dir `review/2026-09-05-lean-audit/` + 8 audits + README + both execution specs exist; `.nvmrc` 22.23.2; `openai` 7.4.0, `opencc-js` 1.4.2, `@sentry/node` = `@sentry/tanstackstart-react` = 10.73.0 (matches WP0.1's correction); the struck PR bullet correctly points at revision item 1; the Storybook bullet correctly states `pnpm test:storybook`.

## §3 `## Program rules` (L22-32) — 11 claims checked, 2 fail

| line | claim                                                                                      | command / evidence                                                                                                                  | class   |
| ---- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------- |
| L24  | "Add **`pnpm test-storybook`** when stories changed."                                      | not in `package.json`; the script is `test:storybook`. The plan's own Context bullet (L10) says it "never existed on Storybook 10". | `wrong` |
| L28  | catalogue "imported by `system-execution-policy.ts:26` and `delayed-execution-gate.ts:37`" | actual imports at `system-execution-policy.ts:23` and `delayed-execution-gate.ts:27,30`. Files and constructs real; lines drifted.  | `stale` |

Holds: local gate (`typecheck`/`lint`/`test:unit`/`test:integration`/`build`/`check:bundles`) — every command in `package.json`; `ensureTestDatabase` at `test-db-setup.ts:334`; `install --frozen-lockfile` / `docker build .` amendment; failing-test policy; schema loop (`db:baseline`, `db:reset`, `check:schema-drift` all exist, `drizzle/` is exactly the stated three + `meta/_journal.json` + 3 snapshots).

## §4 `## Phase 0` preamble (L33-36) — 6 claims checked, all hold or recorded

Anchors `alert-definitions.ts:306-333`, `env.ts:112,144`, `ai-openai-request-contract.ts:13-15`, `merchant-ai-notice-contract.ts:176-177` are pre-Phase-3; `drizzle/0046,0061,0062,0067` no longer exist — deletion recorded by WP1.3. Defect 7's deferral to WP3.3 is closed and recorded in `docs/BETA.md` §2.

## §5 WP0.1 (L37-54) — 12 claims checked, all hold

`git grep "technology-stack\|check-ai-contract-attestations" -- src scripts services .github package.json docs/adr docs/operations docs/standards.md` → **no matches**. `security/technology-stack.json` gone; `check:technology-stack` and `check:ai-contract-attestations` absent from `package.json`.

## §6 WP0.2 (L55-78) — 9 claims checked, all hold

`check-bundle-budget.mjs:44-46` = `mainEntryGzip 130*1024`, `initialClosureGzip 673*1024 // 689,152 — ratchet ...; target 204,800`, `lazyChunkGzip 125*1024` — exactly the recorded ratchet. `vendor-react` is the first group at `vite.config.ts:76-81` with `includeDependenciesRecursively: false` on all four groups. `inbox-search-schema.ts` exists.

## §7 WP0.3 (L79-92) — 8 claims checked, all hold

`Dockerfile.worker` gone; `railway.worker.json` = `"dockerfilePath": "Dockerfile"` + the exact `startCommand`; `error-monitoring-wiring.test.ts:40-46` asserts that startCommand **and** the `compose.local.yml` preload — precisely as the execution note claims. `@sentry/tanstackstart-react` is still a devDependency (struck bullet 6 correct).

## §8 WP0.4 (L93-105) — 9 claims checked, 1 fails

| line | claim                                                                                                                               | command / evidence                                                                                                   | class   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------- |
| L96  | add `"clean": "rm -rf .output dist dist-worker **dist-local-tools dist-provider-services** storybook-static coverage test-results"` | actual: `rm -rf .output dist dist-worker storybook-static coverage test-results`. Both stages died with WP2.5/WP3.7. | `stale` |

Verification grep passes: `auth:generate\|better-auth_migrations\|tsconfig.node.json\|findings/\|drizzle.bak` → no real hits. `src/shared/domain/result.ts` kept (struck bullet 3 correct).

## §9 WP0.5 (L106-109) — 2 claims checked, 1 fails

| line | claim                                                                                                                       | command / evidence                                                                                                                                   | class   |
| ---- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| L108 | "Commits go straight to `main`. If `git push origin main` is rejected … run `gh api -X DELETE …/branches/main/protection`." | Revision item 1 (L593-621) turned `enforce_admins` **on** and reinstated required checks. The section is unstruck and, if followed, would undo that. | `stale` |

## §10 `## Phase 1` intro (L110-113) — 1 claim, holds

## §11 WP1.1 (L114-127) — 15 claims checked, all hold

`docs/external/google/` holds both responses + `attachments/`; `docs/archive/2026-09-lean/` holds every named archive target; the two moved operator tests exist at `scripts/ops/reconcile-publication.test.ts` and `report-capability-refusal.test.ts`; the three prose tests are gone; `scripts/perf/scale-dataset.json` exists at the new path. "the 16 markdown files" under `docs/release-evidence/` is now 10 (9 review + `beta/README.md`) — recorded by WP4.3a's 25 archive moves.

## §12 WP1.2 (L128-141) — 14 claims checked, 4 fail

| line          | claim                                                                                                                                                                 | command / evidence                                                                                                                                                                              | class               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| L136 (step 5) | "In `scripts/check-test-quality.mjs` delete `PINNED_RUNTIME`/`RUNTIME_DRIFT` (:102-105), the fence filter (:287-311), and every `runtimeFence: true` flag (:143-179)" | all present (:86, :91, :264-284, five flags :124-160). Not executed, not recorded anywhere.                                                                                                     | `wrong`             |
| L135 (step 4) | "`package.json:34` → `\"test\": \"vitest run --project=unit\"`"                                                                                                       | no `test` script.                                                                                                                                                                               | `stale` (WP4.2)     |
| L131 (step 1) | delete-list names `error-monitoring-wiring`                                                                                                                           | `src/shared/architecture/error-monitoring-wiring.test.ts` exists and is load-bearing — WP0.1's own correction rewrote it and WP0.3 item 6 cites it. Delete-list contradicts two other sections. | `wrong`             |
| L131 (step 1) | keep-list of 21 names `retired-property-access-islands`                                                                                                               | absent from `src/shared/architecture/`. `retired-review-islands` and `retired-runtime-authorities` survive. No section records its deletion.                                                    | `stale`, unrecorded |

`scripts/check-coverage.mjs` and `check:coverage` are gone ✓ — but `.github/workflows/ci.yml:214` still carries a comment describing `check:coverage` as owning the unit project. Code-side residue.

## §13 WP1.3 (L142-166) — 18 claims checked, 1 fails (large)

| line          | claim                                                                                                                                                                                                                                                                                                                                                                                                                | command / evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | class                            |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| L149 (step 4) | "delete `scripts/migrations/` **entirely** (the 12 orphans, the sidecar, and `0000-auth-tables-bootstrap.sql` …), together with `package.json:63` `db:bootstrap-auth`, `src/shared/db/auth-bootstrap-compatibility.integration.test.ts`, the sidecar reads at `migrate-deploy.ts:70-74,166-168`, `test-db-setup.ts:29-33`, `disable-guard-triggers.ts:3`, `ci.yml:212`, `simulation.yml:69`, and the catalogue rows" | `scripts/migrations/` holds **7 files**. `migrate-deploy.ts:66` reads the sidecar; `test-db-setup.ts:35` reads it; `ci.yml:172` and `simulation.yml:68` `psql -f` it; `auth-bootstrap-compatibility.integration.test.ts:24` reads the bootstrap SQL; `disable-guard-triggers.ts:3` cites it; **7 catalogue rows survive at `entry-point-catalogue.ts:4128-4174`**, one still advertising `db:bootstrap-auth`, which _is_ gone from `package.json`. WP1.3's execution note records deleting only 3 one-off `.sql` files + `google-import-contract.sql`. | `wrong` (unexecuted, unrecorded) |

Holds: `staged-drizzle-migrator.ts` gone; `db-baseline.ts`/`db-reset.ts` exist; `db-constructs.sql` + `db-seed.sql` exist; `drizzle/` is exactly the four-file journal; `migration-verification.test.ts` kept. Minor: step 5 says `validateTestDatabaseTarget` lives in `test-environment.ts`; it is imported from `./test-environment-lease`.

## §14 WP1.4 (L167-194) — 16 claims checked, all hold

Completion grep `contexts/team\|contexts/badge\|contexts/leaderboard\|badge\.awarded\|team_memberships\|team_portal_group_scopes\|staff_assignments\|recognition_\|leaderboard_` over `src scripts e2e .storybook` → **no matches**.

## §15 WP1.5 (L195-221) — 17 claims checked, 1 fails

| line          | claim                                                  | command / evidence                                                                                    | class   |
| ------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ------- |
| L201 (step 3) | "create `docs/legal/CHANGELOG.md` with one dated line" | absent from `docs/legal/` **and** `docs/archive/2026-09-lean/`; no reference anywhere. Never created. | `wrong` |

Holds: verification grep `gate-f\|live-evidence\|legal-document-registry\|create-promotion-manifest\|deploy-beta` → **no matches**; `.railway/`, `scripts/release/`, `release-images.yml`, both `security/*.json` gate files gone; all three legal drafts carry `status: draft` frontmatter; only `railway.json` + `railway.worker.json` survive. The `/privacy` deferral is accurate — no route exists and `docs/BETA.md` §2 carries the record.

## §16 WP1.6 (L222-242) — 13 claims checked, all hold

Verification grep `context-standards\|context-public-interface-authority\|counsel-decision\|operator-command-mutation-classifier\|infrastructure-factory-style` → **no matches**. `lint:ci` = `pnpm lint && check-test-quality.mjs && check-google-provider-identifiers.mjs && check:runtime-environment-contract` — exactly what corrections 2 and 3 say. `docs/architecture/beta-capability-fate-authority.md` gone; `source-content-policy.ts` survives trimmed.

## §17 WP1.7 (L243-272) — 19 claims checked, 1 fails (minor)

| line          | claim                                                            | command / evidence                                                                                      | class                                          |
| ------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| L247 (step 1) | "at `:195-199` render `<ManagerSidebar …/>` **unconditionally**" | `_authenticated.tsx` ~:196 renders `hasRole(ctx.role, 'PropertyManager') ? <ManagerSidebar …/> : null`. | `wrong` (instruction not followed, unrecorded) |

Holds: `home.tsx`, `register.tsx`, `settings/closure.tsx`, `leaderboard.tsx` gone; the `!org.role` redirect guard is in place at ~:110; `max-lines` is 300 in `eslint.config.js`; the fleet-pagination struck bullet is correct.

## §18 WP1.8 (L273-289) — 9 claims checked, all hold

`provider-client-singleton.test.ts`, `provider-target-selection.test.ts`, `ciphertext-format-singleton.test.ts` all exist; the `fetch(` ratchet correction is reflected.

## §19 `## Phase 2` roadmap intro (L290-312) — 11 claims checked, all recorded

Every `services/…` anchor is a dead citation, recorded by WP2.1/WP2.3. `google-provider-authority.ts:809,828,842-866` are past EOF (file is 759 lines) — recorded by WP2.1.

## §20 WP2.1 (L313-323) — 7 claims checked, all hold

`src/composition/google-egress-runtime.ts` exists; `services/` holds one shell script; both Google sidecar Dockerfiles/tsup configs gone.

## §21 WP2.2 (L324-389) — 22 claims checked, 4 fail

| line                 | claim                                                                                                                                        | command / evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | class   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| L388 (Verification)  | "`git grep -n \"google-content\|approvalGap\|assertDirectProviderEgressAllowed\" -- src services scripts` → **none** outside `docs/archive`" | 35 files match in `src`. Live: `src/shared/auth/google-content-{authority,contract}.ts`, `src/shared/db/schema/google-content-control.schema.ts`, `google-content-authority.repository.ts`, `google-content-authorization-check.ts`, `google-content-authorization-vector.ts`, `src/bootstrap.ts:462`. The section's own "What actually dies" note says most of these **survive** — the Verification line was never reconciled with it. (`assertDirectProviderEgressAllowed` → 0 hits ✓.) | `wrong` |
| L327 (step 2)        | delete `googleApprovalGapDisposition`                                                                                                        | `src/shared/release/google-approval-gap.ts` + `.test.ts` alive; `google-provider-authority.ts:622-626` comments on still using it.                                                                                                                                                                                                                                                                                                                                                        | `wrong` |
| L327 (step 2)        | delete `buildRefusingGoogleProviderAuthority` (`:207-258`)                                                                                   | present at `google-provider-authority.ts:130`, called at `:188`. Six `googleContentAuthority.preauthorize(` sites remain (:339,453,474,490,506,546) — matching this section's own "Still to do … the risky half", but **contradicting Phase 2 close's commit trail** which lists `eb4ada82` (step 2 gate), `7ce46aa7` (step 3), `853ac364` (step 4) as landed.                                                                                                                            | `wrong` |
| L367 / L375 (step 1) | "collapse `start_…_v1/v2/v3` into **one** function" … "**Step 1 landed 2026-09-06 (`fb23aba8`)**"                                            | `db-constructs.sql:2379/:2761/:2912` — all three present, v3→v2→v1 delegation intact (`:2776`, `:2930`). The _parameter_ contraction did land (5 args; no vector-mode/policy-version/release-sha; `provision-google-admission-role.ts:62` grants the 5-arg signature). The _collapse_ did not.                                                                                                                                                                                            | `wrong` |

Also: step 4's "`execution-permit-start-deadline-sweep.ts:27,102` is the **last** reader" of `GOOGLE_CONTENT_CAPABILITIES` — there are at least four (`google-provider-authority.ts:27`, the sweep `:26`, `google-content-authority.repository.ts:10`, the sweep test `:14`). `wrong`.

## §22 WP2.3 (L390-467) — 14 claims checked, all hold

`services/` TypeScript = 0 (one `entrypoint.sh`); `src/composition/ai-egress-runtime.ts` exists; `sidecarFunctionIsolationSql` → 0 hits; the WP2.4 re-scope table is narrative.

## §23 WP2.5/WP2.4 (L468-477) — 8 claims checked, 1 fails (minor)

| line | claim                                                                                                                                                               | command / evidence                                                                                                                                                                                                                                                                                                | class   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| L470 | WP2.5 deletes "`check:container-images`, `verify-*-image.mjs`, `smoke-provider-redis-image.sh`, `check:google-runtime-bundle`, `deploy-ci-images.ts` to ~400 lines" | `verify-*-image.mjs` and `check:google-runtime-bundle` → 0 hits ✓. `scripts/ci/smoke-provider-redis-image.sh` **survives**; `check:container-images` survives (justified by the "honest floor" note); `deploy-ci-images.ts` is 762 lines (recorded as 761 in Phase 2 close). Only the shell script is unrecorded. | `stale` |

## §24 `### Settled decisions … (original roadmap bullets)` (L478-485) — 9 claims checked, all recorded

The WP2.4 bullet's `nightly.yml` + deletion of `codeql.yml`/`fallow.yml`/`simulation.yml`/`simulation-invocation.test.ts` is explicitly reversed by the WP2.4 re-scope; all four survive ✓ consistent.

## §25 `## Phase 3` roadmap (L486-495) — 7 struck bullets, all hold

Each `**DONE 2026-09-07 (see Phase 3 progress)**` resolves: WP3.1, 3.2a/b, 3.3, 3.4, 3.5, 3.6, 3.7 all appear in §36.

## §26 `## Phase 4` roadmap (L496-503) — 5 struck bullets, all hold

`WP4.4`, `WP4.3a #481`/`WP4.3b #480`, `WP4.1 #478`, `WP4.2 #477` all named in §40.

## §27 `## Critical files & anchors` (L504-511) — 5 anchors checked, 3 fail

| line | anchor                                                                                         | command / evidence                                                                                                                                                  | class                             |
| ---- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| L506 | `scripts/migrate-deploy.ts:107-246`                                                            | file is **216 lines** — upper bound past EOF (WP1.3 rewrote it, WP2.3 removed `sidecarFunctionIsolationSql`, WP3.2 removed `bindSingleUsDataCellCutoverTarget`).    | `stale`                           |
| L508 | `vite.config.ts:74-95` — rolldown `codeSplitting.groups`                                       | `:74` holds `codeSplitting:` ✓ but the block spans **:74-109** with four groups (WP0.2 steps 1 and 6 expanded it).                                                  | `stale`                           |
| L509 | `src/routes/_authenticated.tsx:112,195-199` — "the only place `'Staff'` is minted client-side" | nothing mints `'Staff'`; WP1.7 replaced it with a redirect guard and WP3.4 renamed the role `Member` end-to-end. The lines still hold the guard/sidebar constructs. | `stale` (recorded by WP1.7/WP3.4) |

`staged-drizzle-migrator.ts:9-15,…` is a dead citation but is the explicit subject of WP1.3. `entry-point-catalogue.ts` holds ✓.

## §28 `## Verification (program level)` (L512-544) — 13 claims checked, 3 fail

| line                        | claim                                                                                                  | command / evidence                                                                                                                                                                                                      | class   |
| --------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| L514                        | "After Phase 0: … `pnpm build && pnpm check:bundles` reports the entry's static closure **≤ 200 KiB**" | the gate's budget is **689,152 B**; `check-bundle-budget.mjs:45` comments "target 204,800". WP0.2 step 4 concluded 200 KiB is unreachable and is "not a Phase 0 acceptance criterion" — this section was never updated. | `stale` |
| L517 (item 2)               | "`pnpm test` (unit only, no database) green under 3 minutes"                                           | no `test` script.                                                                                                                                                                                                       | `stale` |
| L527 (Phase 1 close item 2) | "`pnpm test` with `DATABASE_URL` unset → 1,096 files / 10,147 passed in 86 s"                          | same — the command no longer exists.                                                                                                                                                                                    | `stale` |

Holds: item 1 (`db:reset`, `check:schema-drift`, the three-file journal); item 5 (`git grep -c "" docs/BETA.md` = 115 ≤ 120 — the "114 lines" figure drifted by one, changed by WP3.2b/WP4.3 which folded ADR 0057 into §1); the Phase 1 close delta table is a historical measurement.

## §29 `### CI green, and the four regressions` (L545-560) — 6 claims checked, all hold

`ciphertext-format-singleton.test.ts` exists in `src/shared/architecture/`.

## §30 `## Phase 2 close` (L561-580) — 3 spot-checks + 6 more, all hold

`services/` TS **0** ✓ (one shell script). Dockerfiles **4** ✓ (`Dockerfile`, `.perf-runner`, `.sandbox`, `.google-provider-redis`). tsup configs **1** ✓. tsconfig projects **2** ✓. `deploy-ci-images.ts` **762** vs recorded 761 (trailing-newline convention) ✓.

## §31 `### What Phase 2 taught` (L581-588) — narrative, 2 checkable claims hold

## §32 `## Post-Phase-2 revision` (L589-592) — heading, holds

## §33 revision 1 — review reinstated (L593-621) — 5 claims checked, all hold (`.github/workflows/review.yml` exists; the two reviewer jobs are not in required checks, as the section states)

## §34 revision 2 — off EOL Debian (L623-626) — resolved by the struck bullet at L780; consistent

## §35 revision 3 — cheaper e2e (L627-647) — 4 claims checked, all hold (4 e2e shards in `ci.yml:921`)

## §36 revision 4 — `releaseSha` (L648-651) — closed by Phase 3 R4 (#461); consistent

## §37 revision 5 — reply drafting (L652-657) — open product decision; consistent

## §38 revision 6 — found work (L658-665) — 4 claims checked, all hold

## §39 `## Phase 3 progress` (L666-689) — 3 spot-checks + 5 more, all hold

## §40 `### Found by running the app` (L690-695) — 3 claims, all hold

## §41 `## Phase 3 close` (L696-719) — 4 spot-checks, all hold

`CREATE OR REPLACE FUNCTION` in `db-constructs.sql` = **58** ✓. `CREATE TRIGGER` = **50** ✓ (49 plain + 1 `CREATE CONSTRAINT TRIGGER`, matching an unanchored grep). bounded contexts = **10** ✓ (ai, feed, guest, identity, inbox, integration, portal, property, reporting, review). `compose.local.yml` = **130** ✓.

## §42 `## Phase 4 progress` (L720-735) — 5 claims checked, all hold

## §43 `## Phase 4 close` (L736-762) — 4 spot-checks, all hold

`package.json` scripts = **53** ✓ (counted). active docs (`docs/**/*.md` ex. archive) = **53** ✓ (4 root + 14 operations + 23 adr + 3 agents + 2 security + 3 legal + 2 architecture + 2 external). ADR files = **23** ✓ (22 numbered + README). `eslint.config.js` = **888** ✓.

## §44 `## Assumptions & contingencies` (L763-780) — 7 contingencies, **6 fail**

| line | contingency                                                                                                                                                                                                    | trigger status                                                                                                                                                                                                                          | class   |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| L765 | Storybook: "If you prefer to drop Storybook entirely, WP3.6 instead deletes … **both CI jobs** and the **ten** `@storybook*`/`@vitest/browser*` packages, and **`pnpm test-storybook`** leaves the local gate" | WP3.6 closed 2026-09-07 keeping Storybook; the build-only `storybook` job was already deleted (one job left, not two); the packages are **8**, not ten; `pnpm test-storybook` never existed. Dead trigger, three wrong facts, unstruck. | `wrong` |
| L766 | Railway descriptors: "If Railway is deleted **before WP2.5**"                                                                                                                                                  | WP2.5 closed in Phase 2. Dead trigger, unstruck.                                                                                                                                                                                        | `stale` |
| L767 | Data: "If that changes **before WP1.3 lands**"                                                                                                                                                                 | WP1.3 landed 2026-09-06. Dead trigger, unstruck.                                                                                                                                                                                        | `stale` |
| L768 | `drizzle-kit generate --custom`: "if the installed drizzle-kit rejects `--custom`"                                                                                                                             | `scripts/db-baseline.ts` shipped and the journal is generated. Dead trigger, unstruck.                                                                                                                                                  | `stale` |
| L769 | Worker smoke in CI (WP0.3)                                                                                                                                                                                     | WP0.3's execution note says "the matrix contingency was not needed". Dead trigger, unstruck.                                                                                                                                            | `stale` |
| L770 | `in_memory` retention: "if a later model snapshot accepts … WP3.3 sets it and keeps the 'at most one hour' notice **instead of re-consenting**"                                                                | WP3.3 landed and **did** re-consent (`docs/BETA.md` §2: "RESOLVED … The notice now states 24-hour extended prompt caching" under a new `MERCHANT_AI_NOTICE_VERSION`). Dead trigger, unstruck.                                           | `stale` |

Holds: the branch-protection contingency is correctly struck with the reasoning recorded.

---

## Dead citations — paths the plan names that do not exist today

| path cited                                                                                                                                                                                                                                   | cited at                | deletion recorded?                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------- |
| `docs/legal/CHANGELOG.md`                                                                                                                                                                                                                    | WP1.5 §3                | **No — never created**                    |
| `src/shared/architecture/retired-property-access-islands.test.ts`                                                                                                                                                                            | WP1.2 §1 keep-list      | **No**                                    |
| `scripts/ci/smoke-provider-redis-image.sh` (named for deletion, still present)                                                                                                                                                               | WP2.5                   | **No — inverse: still exists**            |
| `scripts/migrations/` (named for deletion, still present)                                                                                                                                                                                    | WP1.3 §4                | **No — inverse: still exists**            |
| `src/shared/testing/test-environment.ts` for `validateTestDatabaseTarget`                                                                                                                                                                    | WP1.3 §5                | No — moved to `test-environment-lease.ts` |
| `security/technology-stack.json`, `scripts/ci/check-technology-stack*.ts`, `docs/operations/technology-stack-authority.md`, `scripts/check-ai-contract-attestations.ts`, `src/shared/ai-canonicalizer-attestations.test.ts`                  | WP0.1                   | Yes — WP0.1                               |
| `Dockerfile.worker`                                                                                                                                                                                                                          | WP0.3                   | Yes — WP0.3                               |
| `findings/`, `better-auth_migrations/`, `tsconfig.node.json`, `drizzle.bak/`                                                                                                                                                                 | WP0.4                   | Yes — WP0.4                               |
| `docs/comprehensive-beta-implementation-program-2026-08-25.md`, `docs/remaining-work.md`, `docs/prd-phase-13.md`, `docs/research/`, `docs/performance/`, `docs/design/*-2026-08-19.md`                                                       | WP1.1 §3                | Yes — all in `docs/archive/2026-09-lean/` |
| `scripts/review/**` (incl. `zod-v4-conformance.ts`)                                                                                                                                                                                          | WP1.1 §4, WP1.5 §3      | Yes — WP1.1 + WP4.1 (ESLint rule)         |
| `src/shared/db/staged-drizzle-migrator.ts`, `scripts/google-property-binding-index.ts`, `scripts/beta/`, `scripts/bqc/`, `drizzle/0033…0067`                                                                                                 | WP1.3, Phase 0 preamble | Yes — WP1.3                               |
| `src/contexts/{team,badge,leaderboard,staff,notification,dashboard,metric,goal,activity}/`, `src/routes/_authenticated/{home,leaderboard,register}.tsx`, `settings/{closure,recognition}.tsx`                                                | WP1.4, WP1.7, WP3.4     | Yes — WP1.4/WP1.7/WP3.4                   |
| `.railway/`, `scripts/release/`, `src/shared/release/{gate-policy,json-shape-guards,data-cell-cutover-evidence}.ts`, `security/gate-f-approval-roles.json`, `release-images.yml`, `docs/adr/{0013,0014,0021,0043,0058,0059,0060}`            | WP1.5, WP1.4 §11        | Yes — WP1.4/WP1.5/WP3.2a                  |
| `src/shared/governance/{context-standards-*,context-public-interface-authority,infrastructure-factory-style-authority,operator-command-mutation-classifier,metric-read-authority}.ts`, `docs/architecture/beta-capability-fate-authority.md` | WP1.6                   | Yes — WP1.6 + WP3.4                       |
| `services/**` (all TS), `Dockerfile.google-*`, `tsup.google-*`, `tsconfig.railway.json`                                                                                                                                                      | WP2.1, WP2.3, WP2.5     | Yes — Phase 2                             |
| `src/shared/auth/google-content-approval.ts`, `google-content-runtime-bindings.ts`, `scripts/ops/google-content-approval.ts`, `assertDirectProviderEgressAllowed`                                                                            | WP2.2 §1, §6            | Yes — WP2.2 "What actually dies"          |
| `scripts/local-stack/stack.ts`, `src/shared/testing/pinned-runtime.test.ts`, `scripts/check-coverage.mjs`, `neverthrow`                                                                                                                      | WP3.7, WP1.2, WP4.4     | Yes — WP3.7/WP1.2/WP4.4                   |

---

## What needs fixing — 10 lines

1. **Code, not record:** delete `scripts/migrations/` per WP1.3 §4 — or amend WP1.3 to say the auth-bootstrap + permission-version sidecars are permanent, because 5 live consumers and 7 catalogue rows depend on them and one row still advertises the removed `db:bootstrap-auth`.
2. **Code, not record:** finish or formally drop WP1.2 §5 — the runtime fence is fully intact, and the Context bullet still promises WP1.2 removes it.
3. **Code, not record:** `docs/legal/CHANGELOG.md` was never created; WP1.5 §3 asked for it and Phase 5's legal work is the moment to add or drop it.
4. **Record, urgently:** WP2.2's Verification grep (`google-content` → none) is unsatisfiable by the section's own "What actually dies" correction — rewrite it to the surviving-module allowlist.
5. **Record:** Phase 2 close's commit trail claims WP2.2 steps 2/3/4 landed while `preauthorize`, `buildRefusingGoogleProviderAuthority` and `googleApprovalGapDisposition` are all still live — reconcile the trail with the "Still to do … the risky half" note.
6. **Record or code:** the three `start_google_execution_permit_v*` functions were never collapsed; WP2.2 §1 says they were. Either do it or record the deviation.
7. **Record (always-live sections):** Program rules L24 must say `pnpm test:storybook`; L28's two anchors are `:23` and `:27`.
8. **Record (always-live sections):** Critical anchors — `migrate-deploy.ts:107-246` is past EOF (216 lines); `vite.config.ts:74-95` is now `:74-109`; the `'Staff'` sentence is obsolete since WP3.4.
9. **Record (always-live sections):** Verification (program level) still demands a 200 KiB closure the tree ratchets at 689,152 B, and names `pnpm test` three times — a script WP4.2 removed.
10. **Record:** strike the six dead contingencies (Storybook, Railway, Data, `--custom`, worker smoke, `in_memory`); the Storybook one additionally carries three wrong facts, and WP0.5's unstruck "delete branch protection" command now directly contradicts revision item 1.
