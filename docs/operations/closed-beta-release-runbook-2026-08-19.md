# Closed-beta release runbook — 2026-08-19

Both ceremonies are complete: the Google Content approvals are re-signed and
installed (section 1), the AI canary passes and all three capability heads are
restored with the worker's outbox dispatcher enabled (section 2). This document
is now the record of what was done and the procedure for the next re-approval or
re-canary.

## 1. Re-sign the Google Content approvals — DONE 2026-08-19 09:19Z

Both capabilities re-approved at `routeCatalogue=2026-08-16` (bindings
`94dce861-64cf-4e38-8c87-a83866358fe0` for `property.import_gbp_v2`,
`f41eab85-fbd8-48bc-94b5-2c71f03059f5` for `property.read_gbp_performance`,
expiring 2026-09-17), role public keys rotated on web + worker, both redeployed
`SUCCESS`. Every stored version column matches the compiled constants, so
`approvalRecordFromRow` resolves instead of returning null. The keystore now
exists: later re-approvals prompt for the password once, not twice. The
procedure below stands for the next re-approval (route catalogue change, role
rotation, or the 2026-09-17 expiry).

**A re-sign moves two deployment variables, not one.** The first attempt rotated
only `GOOGLE_CONTENT_APPROVAL_ROLE_PUBLIC_KEYS_JSON`, and the import page then
failed with "Accounts unavailable": `POST /integration.listImportAccounts` → 403
`GoogleImportDiscoveryError(unauthorized)`, logged at stage
`google-content-preauthorize` with code **`runtime_binding_mismatch`**. Cause:
`manifestSha256` hashes the prior row's index digest and `evidenceIndexSha256`
hashes the fresh role-document digests, so **every** re-sign changes both, while
`sameRuntimeBinding` compares the stored approval against
`GOOGLE_CONTENT_RUNTIME_BINDINGS_JSON` field for field. Only those two fields
differed; every deployment fact (release SHA, image digests, migration head,
cohort, all version pins) already agreed.

Fixed live at 09:38Z by patching both digests per capability on web + worker and
redeploying, and fixed permanently in the signer: with `--railway-environment` it
now rotates the runtime bindings alongside the role keys, comparing every other
field with RFC 8785 canonicalization first — `imageDigests` legitimately arrives
in a different key order, and it aborts naming the drifted fields if a real
deployment fact has changed, because that needs fresh evidence rather than a
re-sign.

**Why:** `GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION` is now approval-bound. It
pins the Performance route URL, the wire `dailyMetrics` set, the dailyRange
encoding, page size and the response cap, so a route change can no longer ship
without re-approval. Before this ceremony every approval row predated the column
and carried the `unapproved-pre-0056` sentinel, so both Google capabilities
denied `approval_unavailable`.

**What it costs:** nothing but your password. The command re-signs the _existing_
evidence — it never mints new evidence — and installs it through the normal
`ops:google-content-approval` path, which stays ticketed and audited.

```bash
# 1. Open a tunnel to the private database (leave running in another shell).
railway connect Postgres16 --environment google-closed-beta --tunnel-only --port 55500

# 2. Point DATABASE_URL at the tunnel and give the ops CLI a valid env. `--apply`
#    shells out to `ops:google-content-approval`, which boots the operator
#    runtime and validates the whole env schema, so these seven must be present
#    or the install fails after the bundles are already signed. Take them from
#    the deployed service so they match production exactly.
export DATABASE_URL="$(railway variable list --service web --environment google-closed-beta --kv \
  | sed -n 's/^DATABASE_URL=//p' | sed 's#@[^:/]*:[0-9]*#@127.0.0.1:55500#')"
export OPS_OPERATOR_IDENTITIES=denev@kodes.agency
VARS="$(railway variable list --service web --environment google-closed-beta --kv)"
for v in BETTER_AUTH_SECRET BETTER_AUTH_URL RESEND_API_KEY GOOGLE_CLIENT_ID \
         GOOGLE_CLIENT_SECRET ENCRYPTION_KEY OAUTH_STATE_SECRET; do
  export "$v=$(printf '%s\n' "$VARS" | sed -n "s/^$v=//p")"
done
unset VARS

# 3. Dry run: validates both bundles, writes nothing.
pnpm ops:google-content-approval-sign \
  --operator denev@kodes.agency \
  --reason "Route catalogue 2026-08-16 approval" \
  --ticket closed-beta-ai-release-2026-08-19

# 4. Apply, and rotate the role public keys on web + worker in one step.
pnpm ops:google-content-approval-sign \
  --operator denev@kodes.agency \
  --reason "Route catalogue 2026-08-16 approval" \
  --ticket closed-beta-ai-release-2026-08-19 \
  --apply --railway-environment google-closed-beta

# 5. Redeploy so the new role public keys are live.
railway up --service web --environment google-closed-beta --detach
railway up --service worker --environment google-closed-beta --detach
```

First run creates `.secrets/google-content-approval-roles.enc.json` (gitignored,
mode 0600, scrypt N=2^17 + AES-256-GCM). Keep the password: every later
re-approval reuses the same keystore, and losing it means rotating the role
public keys again.

**Verify:** `select capability, route_catalog_version, status from
capability_compliance_approvals order by created_at desc limit 2;` shows
`2026-08-16` / `approved`, then load a property Dashboard — the Performance card
renders instead of "temporarily unavailable".

## 2. AI release gate — canary passed

The AI plane is deployed, its catalogue is re-pinned,
`assert_ai_runtime_catalogue_ready_v1` returns true in the closed beta, and the
synthetic canary now **passes** on release SHA
`89bec3f181fb399a3e472ff4c7c870ee25027b51`:
`{"status":"passed","disposition":"success"}`, settlement `success` with
`usage_known=true` (`input 70, output 97, reasoning 74`). The three capability
heads remain `killed/draining` until they are restored (see below).

Four real defects were fixed to get here:

1. the ops CLI emitted a claim the canary's strict parser rejected (extra
   top-level `releaseSha`);
2. the canary profile capped output at 64 tokens while the deployment runs
   `reasoning_effort: xhigh` (a one-field answer costs ~114 output tokens);
3. the canary output schema used `z.literal`, which derives JSON-Schema `const`
   with no `type` — OpenAI answers **400 `invalid_json_schema`**, which the
   connector reported as `output_invalid`; and
4. the gateway validated the provider's 200 body with
   `parseAiInternalJsonBytes`, whose internal-transport invariant requires every
   number to be a safe integer. OpenAI echoes `"top_p": 0.98`, so a valid 200
   was rejected inside the one-shot fetch closure; the SDK re-labelled that
   throw `Connection error.`, and the connector classified it as
   `post_200_throw` → `output_invalid`. Provider bodies now parse with
   `parseAiProviderJsonBytes` (`finite-numbers`): byte cap, fatal UTF-8, no BOM,
   strict scan, duplicate keys, depth and node caps, and unicode-scalar checks
   all still apply, while internal transport stays integers-only.

Two canary-route-only diagnostics are kept for the next investigation:
`describeCanaryThrow` (error name, message, stack, and cause chain — this is what
revealed that the SDK was masking our own throw) and
`canary_response_json_rejected` carrying `explainJsonBytesRejection`, which names
the first violated rule with its JSON path (it printed
`validate:number_not_integer:$.top_p=0.98`).

## 3. Deploying a release — `pnpm release:beta` (ADR 0051)

```bash
# 0. The audited path needs the operator env + a reachable database (§1 recipe):
#    the tunnel, DATABASE_URL pointed at it, OPS_OPERATOR_IDENTITIES, and the
#    seven app secrets taken from the deployed service.
railway connect Postgres16 --environment google-closed-beta --tunnel-only --port 55500

pnpm release:beta                 # dry run: prints the ordered plan, calls no railway command
pnpm release:beta --apply --operator denev@kodes.agency --reason "<why>"
pnpm release:beta --verify-only   # re-prove the running deployment (expects origin/main)
```

`scripts/release/deploy-beta.ts` owns the procedure — deploy order, both
variable contracts, and the post-deploy proof. It deploys `web` first and alone
(its `preDeployCommand` in `railway.json` runs the migrations), then `worker`,
the two Google services, and the two AI services.

**`--apply` refuses unless all three hold:**

| Refusal                                  | Why                                                                                                                                                                                                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dirty working tree                       | `railway up` uploads the WORKING TREE, so HEAD must describe what ships                                                                                                                                                                               |
| HEAD is not an ancestor of `origin/main` | a release must be reviewed, CI-exercised, merged code (`--force` overrides, loudly)                                                                                                                                                                   |
| no `--operator` / `--reason`             | `--apply` runs through the operator harness: named operator from `OPS_OPERATOR_IDENTITIES`, one audited `policy_decision_audit` row, same contract as every `ops:*` mutation (`--skip-audit` for the incident case where the database is unreachable) |

**Then it waits.** `railway up --detach` returns before the build exists, and
the service variables are written _before_ it — so a read-back taken right
after the upload proves nothing. The script parses each deployment id out of
`railway up`'s build-log URL and polls it to a terminal state; anything but
`SUCCESS` fails the release and skips the health assertions, because there is
no point asserting health against a rollout that did not happen.
`--deploy-timeout <seconds>` bounds the wait (default 900).

**Then it asserts:**

- one `RELEASE_SHA` across all six services, read back from Railway — equal to
  the deployed revision on `--apply`, and to `origin/main` on `--verify-only`
  (`--expect <sha>` names another; `--expect any` drops to "the six agree");
- `/api/health` returning `status: ok` with `db`, `redis`, `migrations` and
  `policy` all true (needs `--app-url` or `BETA_APP_URL`);
- every `ai_execution_control_heads` row `enabled`/`accepting` (needs
  `DATABASE_URL`; prints a `skipped` line otherwise).

A failing assertion exits non-zero naming the service and the observed value.
There is no per-release evidence document to hand-write: `--verify-only`
reproduces the proof on demand.

**Why the script has two service classes** — this is the part to preserve in any
edit, because it is a property of the services, not of the script.

`RELEASE_SHA` and `SOURCE_REVISION` are one fact with two names. `RELEASE_SHA`
is a service variable, while `IMAGE_SOURCE_REVISION` is baked at build time from
the `SOURCE_REVISION` build argument, and `assertReleaseIdentity` refuses a
production boot when they differ. Setting only `RELEASE_SHA` — what this section
used to say — produced a `FAILED` web deploy and a crashed worker on 2026-08-21.
So `web`, `worker`, `google-egress-gateway` and `google-execution-admission`
receive both.

**The two AI services take `RELEASE_SHA` only.** Their environments are exact
allowlists (`services/ai-execution-admission/environment.ts`,
`services/ai-egress-gateway/environment.ts`) and refuse to start if any other
variable is present, so `SOURCE_REVISION` MUST NOT be set on them. Their images
do not bake `IMAGE_SOURCE_REVISION`, so the identity guard cannot fire there.

**A routine redeploy does NOT need a canary.** Capability heads are scope-keyed,
not release-keyed, and runtime dispatch never compares the running `RELEASE_SHA`
against them — only `restore` does. Verified 2026-08-21: all six services moved
to a new revision, all three capability heads stayed `enabled/accepting`, and a
real reply settled `success` with live token usage. Do not kill working
capabilities to satisfy an activation gate; see §2 below for when the ceremony
genuinely applies.

**Running a canary** — for ACTIVATION only (each release SHA gets three
generations; canary heads are keyed by release SHA, so a burnt head needs a new
SHA on both AI services).

**Precondition, discoverable nowhere else:** `issue_ai_canary_authorization_v1`
refuses unless `review_analysis`, `reply_drafting` AND `property_trends` are all
`killed`/`draining`. With any of them `enabled` the CLI answers only
`AI canary authorization is not eligible for issue`, naming nothing. So the
ceremony can only be run on a plane that is already stopped — which is exactly
why a healthy redeploy must not attempt it (§3, ADR 0051). If you are here to
activate capabilities that are currently killed, continue. If you are here after
an ordinary deploy, stop.

```bash
SHA=$(openssl rand -hex 20)
for svc in ai-egress-gateway ai-execution-admission; do
  railway variable set RELEASE_SHA=$SHA --service $svc --environment google-closed-beta --skip-deploys
  railway up --service $svc --environment google-closed-beta --detach
done
# after both are SUCCESS:
CLAIM=$(pnpm ops:ai-canary issue $SHA --operator denev@kodes.agency \
  --reason "release canary" --ticket closed-beta-ai-release-2026-08-19 --apply | tail -1)
```

The canary MUST run with an exact-allowlist environment — it refuses to start if
any other variable is present (`AI_SAFETY_IDENTIFIER_HMAC_KEYS` is the one the
gateway container adds). Pipe the claim into
`env -i PATH=... <the 15 canary-owned vars> node dist-ai-egress-gateway/canary.js`
inside the gateway container, or deploy `railway.ai-egress-canary.json` as its
own one-shot service, which provides exactly that environment.

**Capability restore — DONE 2026-08-19 09:25Z.** All three heads moved
`killed/draining` → `enabled/accepting` at generation 2 on
`89bec3f181fb399a3e472ff4c7c870ee25027b51`. The command needs the explicit
`capability` scope and the confirmation token, which the one-liner above omitted:

```bash
pnpm ops:ai-control restore capability <capability> private-beta-global-v1 <release-sha> \
  --operator denev@kodes.agency \
  --reason "Closed-beta AI release: canary passed" \
  --ticket closed-beta-ai-release-2026-08-19 \
  --apply --yes ops:ai-control
```

Run it without `--apply` first: it prints `would_restore` with the before/target
states and writes nothing.

**Dispatcher — DONE 2026-08-19 09:25Z.** `OUTBOX_DISPATCHER_ENABLED` went
`false` → `true` on the worker, which redeployed `SUCCESS`. The worker then
logged `job readiness OK`, registered 7 capability-gated handlers and 4 inbox
consumers, and the relay drained the 14-event backlog: 0 unpublished, 0 stale
leases. No `OUTBOX_*_CUTOVER` variable is set, so every inbox family stays
`record-only` — the durable path records receipts while the in-process bus still
delivers.

Order matters if this is ever re-run: heads first, dispatcher second. With the
heads killed, every review event would be consumed and terminal-skipped, and the
analysis watermark does not backfill.

**To roll the dispatcher back:**
`railway variable set OUTBOX_DISPATCHER_ENABLED=false --service worker --environment google-closed-beta`
