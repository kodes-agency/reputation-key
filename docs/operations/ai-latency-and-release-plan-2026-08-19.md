# AI latency fix + release plan — 2026-08-19

> **Historical record.** This captures the measured AI incident and release
> procedure used on 2026-08-19. It is not current deployment authority. Use
> [Immutable release promotion](immutable-release-promotion.md),
> [ADR 0057](../adr/0057-single-us-beta-data-cell.md), and the current
> [AI release-evidence index](../product-readiness-program-2026-07/ai-governance/ai-release-evidence-index.md)
> for any new candidate.

## What changed and why

`reasoning: { effort: 'xhigh' }` was hardcoded as a type literal in
`buildClosedOpenAiRequest` and applied to all four routes. Every route here is
constrained-vocabulary selection (enums, or IDs from a supplied candidate list).
Measured by replaying the exact production request against the live deployment:

| route            | xhigh                                          | low               |
| ---------------- | ---------------------------------------------- | ----------------- |
| review-analysis  | 26.2 s, 4096 tokens, **truncated, empty body** | 2.2 s, 204 tokens |
| property-trend   | 55.5 s, 8192 tokens, **truncated, empty body** | 2.0 s, 203 tokens |
| reply-suggestion | 42.5 s, 6144 tokens, **truncated, empty body** | 1.2 s, 80 tokens  |
| synthetic-canary | 1.4 s, 110 tokens                              | 1.0 s, 39 tokens  |

At `xhigh` the model spends its whole output budget on reasoning and returns nothing
(`incomplete_details.reason = 'max_output_tokens'`), so `safeParse` fails and the route
reports a bare `output_invalid` after a fully-billed call. The three replies that did
succeed carried 3492/3934/5672 reasoning tokens against a 6144 ceiling — the same cliff,
survived by luck.

The synthetic canary is the only task trivial enough to survive `xhigh`, which is why the
release gate stayed green while `ai_review_analyses` sat at 0.

Latency segments confirm nothing else is slow: `create_to_admit` 0.000 s,
`admit_to_consume` 0.111–0.161 s, `consume_to_settle` 36–45 s. Fixed overhead ~120 ms.

Prompt caching is not a lever: inputs are ~160 tokens and OpenAI caches at ≥1024, so
`cached_tokens = 0` is correct rather than a defect.

## Code changes

- `src/shared/ai-openai-provider-profile.ts` — `OPENAI_REQUEST_SHAPE_V1.reasoning.effort`
  becomes the placeholder `'route-profile-effort'`, matching the existing
  `maxOutputTokens: 'route-profile-integer'`. Moves `OPENAI_REQUEST_SHAPE_V1_DIGEST`.
- `src/shared/ai-openai-request-contract.ts` — `AI_REASONING_EFFORTS_V1`
  (`none|low|medium|high`), `AiReasoningEffortV1`, and `reasoningEffort` is now a
  required, validated input. `minimal` excluded (model returns 400); `xhigh`/`max`
  excluded by measurement.
- `src/shared/ai-operation-profiles.ts` — `reasoningEffort` on the profile type and all
  four profiles (`low`); ceilings resized to measured usage
  (4096/6144/8192/2048 → 1024/1024/2048/512) so a runaway fails in ~4 s, not ~55 s.
- `src/shared/db/schema/ai.schema.ts` — `reasoning_effort varchar(16) NOT NULL` plus
  `ai_operation_profiles_reasoning_effort_valid` CHECK mirroring the TypeScript ladder.
- `services/ai-egress-gateway/{route-preparer,canary}.ts` — pass `profile.reasoningEffort`.
- `services/ai-egress-gateway/openai-connector.ts` — content-free
  `openai_output_truncated` diagnostic (provider enum + three integers). Truncation was
  previously unhandled anywhere in the gateway.

## Migration ceremony

`drizzle/0066_ai-reasoning-effort-per-route.sql` (27 statements) plus in-place corrections
to shipped migrations so a migrate from empty stays self-consistent at every step.

Moved on all four operation profiles: `artifact_attestations` (the jsonb blob, because
`SDK_ATTESTATION` embeds the shape digest), `artifact_attestations_digest`,
`sdk_request_shape_digest`, `max_output_tokens`, `profile_digest`, plus the new
`reasoning_effort`. Byte-identical: `output_schema_digest`, `prompt_digest`,
`static_token_bearing_bytes`, `static_token_bearing_digest`, all byte limits, all deadlines.

Collateral that had to move with it:

- `ai_provider_deployment_profiles.deployment_contract` + `profile_digest`
  (`c362776c…` → `64ccc32f…`), because
  `OPENAI_PROVIDER_DEPLOYMENT_CONTRACT_V1.requestShapeDigest` _is_ the shape digest.
- The `ai_provider_profiles_contract_valid` CHECK literal, carried in 0046, 0050 and 0055 —
  all three edited in place, because a row updated only in 0046 violates the old literal at
  the moment 0050 runs and a fresh migrate fails.
- `assert_ai_runtime_catalogue_ready_v1` is CALLED inside DO blocks at 0062:204 and
  0065:90, byte-comparing `to_jsonb(row) - 'created_at'` for the whole catalogue; the new
  column adds a key to that projection, so both embedded projections were updated.
- `issue_ai_canary_authorization_v1` pins TWO digests (synthetic-canary profile AND
  provider profile); both re-pinned or every canary issue returns "not eligible".
- Five `__drizzle_migrations` hash restamps, since editing shipped files moves the sha256
  that `check:schema-drift` compares.

## Verification status

- Incremental migrate on a database at 65: **VERIFIED GREEN** — 1 migration applied,
  67 ledger rows, all four operation rows and the provider row deep-equal to the compiled
  catalogue, readiness returns true against `64ccc32f`, and `reasoning_effort='xhigh'` is
  rejected with SQLSTATE 23514.
- `pnpm typecheck`: 0 (run before the host lost fork capacity).
- **Outstanding**, blocked by host memory exhaustion (see below): fresh migrate from empty,
  the full gate set, deploy, and the end-to-end latency proof.

## Host blocker

The machine reached 0.07 GiB free of 24 GiB after 196 h uptime. `fork()` returns EAGAIN, so
no subprocess can start — `/bin/echo` fails, `pnpm` and `git` cannot run, and the PostgreSQL
postmaster itself logged `could not fork new process for connection`, which surfaced to
clients as `ECONNRESET`. This is environmental, not a code fault.

## Resume procedure

Free memory first (the largest consumers are a 28-process WebKit/Safari fan and
`herdr server`), confirm `/bin/echo ok` runs, then:

```sh
cd /Users/bozhidardenev/kodes/projects/rep-key

# 1. Fresh-migrate proof through the production pre-deploy authority
createdb effort_fresh
DATABASE_URL=postgresql://test:test@localhost:5432/effort_fresh \
  DATABASE_URL_POOLER=postgresql://test:test@localhost:5432/effort_fresh \
  pnpm db:migrate-deploy

# 2. Gates
pnpm typecheck && pnpm lint:ci && pnpm test:unit
TEST_DATABASE_URL=postgresql://test:test@localhost:5432/test pnpm test:integration
pnpm test:storybook
pnpm check:schema-drift          # compares model vs migrated catalogue + ledger hashes
pnpm check:language-verifier && pnpm check:ai-contract-attestations \
  && pnpm check:ai-governance-artifacts

# 3. Deploy — admission BEFORE gateway (its boot readiness probes admission over mTLS)
pnpm build && pnpm build:worker && pnpm build:ai-egress-gateway \
  && pnpm build:ai-execution-admission
# web carries the migration
railway up --service web --environment google-closed-beta
railway up --service ai-execution-admission --environment google-closed-beta
railway up --service ai-egress-gateway --environment google-closed-beta
railway up --service worker --environment google-closed-beta
```

Then click suggest reply and expect ~1.5–2.5 s. Confirm with:

```sql
SELECT round(extract(epoch FROM (s.settled_at - o.created_at))::numeric, 2) AS total_s,
       s.disposition, s.output_tokens, s.reasoning_tokens
FROM ai_operations o
JOIN ai_execution_permits p ON p.operation_id = o.id
JOIN ai_execution_permit_settlements s ON s.permit_id = p.id
ORDER BY s.settled_at DESC LIMIT 3;
```

Expect `total_s` ≈ 1.5–2.5, `disposition = success`, `reasoning_tokens` under ~100.

## Git state and commit plan

Branch `feat/bqc-8-3-lifecycle-at-scale`, upstream `origin/main`, 17 ahead / 0 behind.
478 uncommitted worktree entries, **0 staged**. No PR exists for this branch. Remote default
is `main`. CI fires 4 workflows on `pull_request`; `ci.yml` runs migrations,
`db:migrate-deploy` parity, `check:schema-drift`, the full test suite, Docker builds,
Gitleaks and Playwright.

MUST NOT be committed:

1. `.fallow/churn.bin` — tracked, modified binary; ignore rules are inert on tracked paths,
   so `git add -A` would sweep it in. Restore it instead.
2. `.tmp-unit-results.json` — tracked test artifact, matched by no ignore rule.
3. The nine untracked `docs/…/evidence/baseline-2026-08-17T*/` directories (58 regenerable
   local baseline files).

Already safe by ignore rule: `.env`, `.secrets/` (3 files), `.local-stack/` (52 key/pem),
`node_modules`, `dist`, `coverage`, `storybook-static`, `test-results`, `.output`.
Correction to an earlier note in this session: there is **no `.npmrc`** anywhere in the
working tree — verified by a full-tree find — so the plaintext-npm-token concern was
unfounded. `.gitignore` still has no `.npmrc` rule, so never use `git add -A` here.

Commit series (each scoped, in dependency order):

1. `feat(ai): parse Google review comment envelopes` — envelope parser, `translated_text`
   column and migration, adapter mapping, reparse script, UI display of original plus
   translation.
2. `feat(ai): support Bulgarian reply drafting` — `bg-Cyrl` in the language catalogue,
   script consistency, reply templates, regenerated attested language profile, consent
   notice v2, widened contract CHECKs to a known-version set, review schema group CHECK.
3. `fix(ai): accept source epoch 0 across the request chain` — domain rules, wire schemas,
   reply provenance, repository restore path, and the epoch-0 regression tests.
4. `fix(ai): repair the admission authority` — `admit_ai_property_v1` capability-vs-purpose
   vocabulary and the inverted suspension check (`drizzle/0063`), plus the
   production-faithful admission integration fixture.
5. `fix(ai): order the reply grant expiries` — `drizzle/0064` (`token <= draft`) and the
   first reply-route admission integration test.
6. `fix(ai): re-pin the reply output schema digests` — `drizzle/0065` and the
   catalogue/pattern parity test that would have caught the missing `bg-Cyrl`.
7. `perf(ai): govern reasoning effort per route` — this change: the per-route effort
   parameter, resized ceilings, truncation diagnostic, `drizzle/0066` and the in-place
   corrections to 0046/0050/0055/0062/0065.
8. `docs(ops): record the closed-beta defect log` — the defect log, release runbook and this
   plan.

Then `git push -u origin feat/bqc-8-3-lifecycle-at-scale` and open one PR into `main`
titled **"Closed beta: enable all AI features"**, letting CI run the fresh-migrate and
schema-drift gates that could not be run locally. `main` comes up to date by merging that PR;
local `main` is 125 behind `origin/main` and is not the working base, so fast-forward it
separately rather than merging into it.
