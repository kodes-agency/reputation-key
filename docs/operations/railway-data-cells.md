# Railway beta Data Cell topology and cutover

Status: single-cell target contract authored; live cutover not applied
Owner: Platform/Operations
Authority: ADRs 0057–0058 and `REG-02` in
`docs/comprehensive-beta-implementation-program-2026-08-25.md`

## Beta topology

RepKey beta has one production Railway Data Cell and one separately
permissioned non-production mirror of that graph. The production cell is:

| Environment | Logical cell | Compute placement             | Bucket placement           | Public host            |
| ----------- | ------------ | ----------------------------- | -------------------------- | ---------------------- |
| `cell-us`   | `us`         | US West/California `us-west2` | US West/California (`sjc`) | `us.reputationkey.app` |

The mirror is a deployment profile, not a second Data Cell:

| Deployment profile | Railway project                    | Custom-domain ownership     | Application origin                                  |
| ------------------ | ---------------------------------- | --------------------------- | --------------------------------------------------- |
| `production`       | `reputation-key-us-beta`           | `us.reputationkey.app`      | `https://us.reputationkey.app`                      |
| `rehearsal`        | `reputation-key-us-beta-rehearsal` | no production custom domain | distinct HTTPS origin in shared `REHEARSAL_APP_URL` |

Both profiles use logical cell `us`, environment name `cell-us`, compute
`us-west2`, and bucket `sjc`. Do not describe `us-west2` as a precise city:
Railway documents it only as US West/California. The rehearsal project must
have its own scoped credentials and must never attach `us.reputationkey.app`.
The projects are deliberately dedicated and each has exactly one Railway
environment total, named `cell-us`. Rename a fresh project's default
environment to `cell-us`; do not create `cell-us` alongside a retained default.
Do not add staging, preview, or legacy environments or service instances to
either project.

Railway documents `us-west2` as its US West Metal service region and `sjc` as
its US West/California bucket region. Verify these identifiers again from the
[Railway deployment-region documentation](https://docs.railway.com/deployments/regions)
and [Railway bucket-region documentation](https://docs.railway.com/cli/bucket)
immediately before provisioning; provider availability can change.

All 245 countries in the versioned supported-country set allocate explicitly to
logical cell `us` during beta. Customer geography does not create another
deployment.
`europe` and `global` remain known, denied future identifiers with no countries,
workloads, Railway environments, or beta evidence obligations.

The `cell-us` environment contains:

- `web` and one scheduler-owning `worker`;
- one non-serving `schema-migrator` job with restart policy `NEVER`; it exits
  after applying the signed schema and has no domain, Redis, bucket, provider,
  or application runtime credentials;
- independent `Postgres`, `Cache Redis`, and `Queue Redis` resources;
- private `object-store` bucket in `sjc`;
- a distinct, volume-free `google-provider-redis` service for short-lived
  provider material;
- `google-egress-gateway` and `google-execution-admission`; and
- `ai-egress-gateway` and `ai-execution-admission`.

One Data Cell is still a complete isolation and recovery boundary. It does not
permit cache and queue Redis to share a server, provider material to enter a
general Redis resource, or application services to bypass admission/egress
services.

### Sidecar platform health and protected ingress

Each of the four retained sidecars binds two private listeners on the same
Railway service:

- `PORT=8080` is ordinary HTTP and exposes only exact, content-free
  `GET /health/live` and `GET /health/ready` responses for Railway and the
  external availability monitor;
- `INTERNAL_MTLS_PORT=8443` remains the protected application/admission
  listener used by the fixed `*.railway.internal:8443` origins; and
- `PROCESSING_CELL=us` is mandatory. A dormant `europe` or `global` value is a
  boot refusal, never a fallback target.

Railway health checks target `/health/ready` on `PORT`. Liveness has no
dependency read. Readiness is recomputed on every request: Google admission
checks its dedicated PostgreSQL authority and provider Redis; Google gateway
checks Google admission; AI admission checks its control database; AI gateway
checks its connector/admission readiness contract. A bounded timeout or any
dependency failure returns content-free `503`; it never opens, aliases, or
relaxes the mTLS listener.

On `SIGTERM`, `SIGINT`, an unhandled rejection, or an uncaught exception, one
process owner marks readiness unavailable before draining protected ingress,
then closes dependencies and the health listener and flushes monitoring within
the Railway drain budget. Fatal or failed/timed-out cleanup exits non-zero.
Every sidecar receives the shared Germany-ingestion `SENTRY_DSN` and sampling
value; its preload removes competing SDK fatal owners and uses the shared
scrubber before dynamically loading the protected runtime. The Docker images
expose both ports, and the temporary root `railway.*sidecar*.json` files mirror
the health path until the controlled Config-as-Code ownership cutover removes
them.

Provider Redis is a signed RepKey release image on private Railway networking,
with no public TCP proxy or volume. It binds only TLS port 6380, disables RDB,
AOF, and replication, uses bounded `noeviction` memory, disables the default
user, and denies persistence/admin commands to its dedicated ACL identity. The
environment-scoped `PROVIDER_EPHEMERAL_REDIS_URL` must use the private
`google-provider-redis.railway.internal:6380` endpoint with a non-default user;
the private CA is supplied separately.

Cache/rate-limit Redis and BullMQ Redis are separate resources on private
networking. Both web and worker validate the queue service before constructing
BullMQ: Redis 6.2 or newer, `GETDEL` present, and
`maxmemory-policy=noeviction`. Non-conforming state fails boot. Bucket
references use Railway's `BUCKET`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`,
`REGION`, and `ENDPOINT` outputs with `S3_FORCE_PATH_STYLE=false`.

## Source, variable, and release ownership

`.railway/railway.ts` is the sole owner of every runtime and migrator service
source as well as resources, placement, references, deployment-profile domain
policy, process boundaries, and deployment settings. The graph accepts one
explicit canonical `REPKEY_RAILWAY_SERVICE_SOURCE_MAP_JSON` document:

- `foundation` is source-less and may be used once to create a fresh isolated
  project; and
- `promotion` contains the signed manifest's exact lowercase
  `repository@sha256:<digest>` references in the canonical staged order.

Railway's CLI refuses to register a new custom domain through configuration as
code. The production foundation therefore omits `us.reputationkey.app` while
creating `web`. After the source-less graph is proved, the separate
`infra:railway:domain` ceremony registers that one hostname against the exact
reviewed project, environment, service, and service-instance IDs. Promotion
graphs then declare the already-existing hostname so IaC retains it. This is a
bounded platform exception for domain registration only; it is not another
source owner and does not create another Data Cell.

After any source exists, never render or apply the foundation document: doing
so would request source removal. `release:migrate-cell` advances
`schema-migrator`; `release:beta` advances the seven serving services. Both use
saved IaC plans, not out-of-band source attachment. `railway service source
connect`, dashboard source edits, GitHub sources, local uploads, mutable image
tags, and per-environment rebuilds are prohibited.

The IaC digest proves the desired graph; it does not prove the identity of the
local code authorized to plan or apply it. Promotion manifest v4 therefore
signs `contract.releaseControllerSha256` over `.railway`, package/lock/toolchain
inputs, all release scripts, the operator-command entry point, Identity,
Property, and Team authority, and shared policy/runtime code. Railway plan evidence
v5 copies that value to
`release.controllerSha256`, and bootstrap authorization v2 records the same
signed digest in its release record.

The planner, candidate migrator, and serving deployer recompute the deterministic
source-set digest and refuse a manifest/plan/local mismatch before Cosign,
Railway, or audit actions. Both mutating controllers recheck after Cosign;
serving promotion checks once more immediately before dynamically importing the
operator authority. A covered local edit invalidates the retained release even
when `iac.sha256` still matches: build and sign a new manifest, then capture a
new plan.

Never place secret values in `.railway/railway.ts`.

| Owner              | Variable families                                                               | Rule                                                                                            |
| ------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Railway/Platform   | database, Redis, bucket outputs, and rehearsal application origin               | Created in `cell-us`; bucket placement is immutable; `REHEARSAL_APP_URL` is non-production only |
| Security           | auth, encryption, OAuth, Portal, unsubscribe, signing, and mTLS key material    | Use versioned keyrings where supported and distinct web/worker/sidecar credentials              |
| Schema migration   | `REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS`                                    | Reaches only the one-shot schema migrator; never web, worker, Redis, or provider sidecars       |
| Google integration | OAuth client, Pub/Sub identity/topic, content bindings, admission database role | Admission receives a dedicated execute-only role, never the database-owner URL                  |
| AI integration     | OpenAI key, inventory/profile digests, admission/provenance keys                | OpenAI key reaches only AI egress; admission signing key reaches only AI admission              |
| Operations         | Resend, Sentry, alert webhook, metrics token, operator identities               | Named owner and live-provider verification required                                             |
| Release controller | `RELEASE_SHA`, `RELEASE_MANIFEST_SHA256`, baked `IMAGE_SOURCE_REVISION`         | IaC uses `preserve()` for the two per-service variables; all values describe one signed release |

Executable topology tests prove that web lacks worker-only pseudonym secrets,
web and worker use distinct client certificates, sidecars receive exact
allowlists, and application state is referenced only from the active cell.

### Google Content approval activation in source-less `cell-us`

The signer is preparation-only: it rejects `--apply` before any database write
and writes four private bundles plus `role-public-keys.json` under the
gitignored `.secrets/google-content-approval-bundles` directory. Activation is
owned by `infra:railway:google-content-approval`. The controller accepts all
four capabilities (`property.import_gbp_v2`, `property.read_gbp_performance`,
`property.connect_gbp`, and `property.publish_reply`) in one canonical private
intent and refuses a partial binding map, partial public-key map, mixed release,
mixed owner, or same-binding role-key rotation.

Before planning, kill all four capabilities and completely drain active and
cleanup work. This is mandatory, not an availability optimization: every
approval insertion advances the global policy version and therefore fences
previously admitted/started permits. The repository retains prior immutable
approvals and selects the newest approval whose complete runtime binding exactly
matches the caller, so old and new processes can each resolve their own binding
during a later rolling overlap. Retained approval IDs also remain resolvable for
permit validation, but the policy-version advance means this ceremony does not
promise that pre-activation permits continue.

With Railway CLI exactly 5.45.2 and a logged-in user or account/workspace-scoped
`RAILWAY_API_TOKEN` (never an inherited environment-scoped `RAILWAY_TOKEN`),
create the no-overwrite, mode-0600 intent against the opaque production IDs:

```bash
pnpm infra:railway:google-content-approval plan \
  --cell us \
  --deployment-profile production \
  --project-id <reputation-key-us-beta-project-id> \
  --environment-id <cell-us-environment-id> \
  --ticket <change-ticket> \
  --public-keys .secrets/google-content-approval-bundles/role-public-keys.json \
  --bundle .secrets/google-content-approval-bundles/property-import_gbp_v2.json \
  --bundle .secrets/google-content-approval-bundles/property-read_gbp_performance.json \
  --bundle .secrets/google-content-approval-bundles/property-connect_gbp.json \
  --bundle .secrets/google-content-approval-bundles/property-publish_reply.json \
  --intent .secrets/google-content-approval-activation.json
```

Review the intent, its printed lowercase SHA-256, ticket, exact project and
environment IDs, all four candidates, complete runtime/public-key maps, and the
full before/expected/unrelated configuration fingerprints. Apply those exact
bytes through the audited operator path:

```bash
pnpm infra:railway:google-content-approval apply \
  --cell us \
  --deployment-profile production \
  --project-id <reputation-key-us-beta-project-id> \
  --environment-id <cell-us-environment-id> \
  --intent .secrets/google-content-approval-activation.json \
  --intent-sha256 <reviewed-sha256> \
  --operator <registered-operator> \
  --reason "<change-record and reason>" \
  --ticket <change-ticket>
```

The apply path re-proves the sole source-less `cell-us` foundation and complete
drain, installs any missing exact approval rows first, re-reads their candidate
digests, then makes one Railway edit containing exactly
`GOOGLE_CONTENT_RUNTIME_BINDINGS_JSON` and
`GOOGLE_CONTENT_APPROVAL_ROLE_PUBLIC_KEYS_JSON`. It compares the entire live
configuration with the reviewed expected state and separately proves unrelated
configuration unchanged. If an invocation ends ambiguously, rerun the same
command as `recover`; it resumes from the immutable intent plus observed
per-capability rows and Railway state, without duplicating rows or replaying an
already committed edit. Finish with `verify` using the same target, intent, and
SHA-256 (operator/reason are not required for this read-only mode).

This controller changes no service source. Once verification succeeds, the
signed release flow remains the only authority allowed to start web, worker, or
sidecar sources. Manual database installation, Railway dashboard copying,
direct variable changes, and direct redeployment are prohibited substitutes.

## Current live-state exception

The existing `reputation-key` Railway project is migration input, not the
target topology:

- `production` has PostgreSQL and Redis in Amsterdam;
- `google-closed-beta` and `staging` combine application and non-production
  support services in Amsterdam; and
- service Config-as-Code still points at root `railway*.json` files.

Do not mutate those resources in place to look like US infrastructure. Create
fresh `cell-us` state, restore/copy under the recovery fence, verify it, and
cut traffic over with a retained rollback point. Railway's dual-ownership
refusal while legacy config files still own services is a guard, not something
to bypass.

## Offline validation and remote plan

Before any Railway action:

```bash
pnpm infra:railway:validate
pnpm typecheck
```

Use Railway CLI **exactly 5.45.2 for the one-time foundation and domain
ceremonies**. Their validators are pinned to that CLI's saved-plan and JSON
schemas and refuse both older and newer versions until a deliberate contract
review updates the pin. Ordinary signed release promotion accepts 5.45.2 or
newer and depends on the pinned-plan interface: `railway config plan --out`
writes the reviewed artifact and `railway config apply --plan` applies it
unchanged.

The contract renders exactly one graph and proves placement, bucket, domain,
no implicit environment, exact sidecar allowlists, process credentials,
resource references, health activation, drain budgets, and Config-as-Code
ownership. It also proves that `cell-europe` and `cell-global` are refused.

For the one-time foundation only, first rename the fresh project's default
environment to `cell-us`; do not create another environment. The repository
foundation controller then reads the complete project and refuses unless the
reviewed project ID/name and environment ID/name resolve to exactly that one
accessible environment **and the project contains zero services, service
instances, buckets, volume instances, and unmerged changes**. This proof
requires a logged-in user or `RAILWAY_API_TOKEN` with account/workspace-wide
visibility; the environment-scoped `RAILWAY_TOKEN` is rejected because it
cannot prove that a sibling environment is absent. The controller performs the
same live preflight immediately before both the saved plan and its later apply.
That credential rule also applies to candidate planning, schema migration, and
serving promotion: all three rely on the same full-project isolation proof and
refuse an inherited `RAILWAY_TOKEN`.
It derives the only allowed project name from the explicit deployment profile,
pins the opaque IDs, and supplies the canonical source-less input:

```bash
RAILWAY_FOUNDATION_PLAN_DIR="$(mktemp -d)"
pnpm infra:railway:foundation -- plan \
  --cell us \
  --deployment-profile rehearsal \
  --project-id "<reviewed-project-id>" \
  --environment-id "<reviewed-cell-us-environment-id>" \
  --plan "$RAILWAY_FOUNDATION_PLAN_DIR/foundation.plan"

# Record the lowercase sha256 printed by the plan command. After named review
# and approval of those exact non-destructive additions, apply those bytes:
pnpm infra:railway:foundation -- apply \
  --cell us \
  --deployment-profile rehearsal \
  --project-id "<reviewed-project-id>" \
  --environment-id "<reviewed-cell-us-environment-id>" \
  --plan "$RAILWAY_FOUNDATION_PLAN_DIR/foundation.plan" \
  --plan-sha256 "<printed-foundation-plan-sha256>"

# If apply returned ambiguously after Railway may have committed, do not retry
# the create. Prove the exact reviewed final graph instead:
pnpm infra:railway:foundation -- verify \
  --cell us \
  --deployment-profile rehearsal \
  --project-id "<reviewed-project-id>" \
  --environment-id "<reviewed-cell-us-environment-id>" \
  --plan "$RAILWAY_FOUNDATION_PLAN_DIR/foundation.plan" \
  --plan-sha256 "<printed-foundation-plan-sha256>"
```

Save the foundation plan to a private file, review the exact additions, and
apply that same saved plan. This is a named setup action, not part of ordinary
promotion. It is forbidden against the legacy `reputation-key` project or any
project with any pre-existing service, instance, bucket, volume, or staged
change. The controller requires exactly 16 reviewed `resource.create`
operations (four groups, eight source-less services, three managed databases,
and one bucket), verifies Railway's internal change-set hash and the frozen
profile graph digest, independently reproduces Railway's clean-Git-tree or
dirty-`.railway` source identity, then binds the complete saved bytes to the
printed SHA-256. After apply, every operation must report `applied`, followed by an
exact readback of the eight source-less services, three managed databases,
three database volumes, and `object-store` bucket, plus a fresh read-only IaC
plan proving the complete frozen graph is no-drift. A normal successful apply
does not defer this placement/configuration proof to a later command. For production, use its
distinct reviewed IDs and
`--deployment-profile production`; never reuse credentials between profiles.
The controller refuses a remote project name that does not exactly match
`reputation-key-us-beta` for production or
`reputation-key-us-beta-rehearsal` for rehearsal. It also refuses a changed,
symlinked, destructive, or wrong-environment saved plan before mutation. Delete
the private plan directory after retaining the approved redacted evidence.
If apply returned ambiguously, `verify` performs the same exact inventory and
fresh read-only source-less IaC proof without repeating the create. Both paths
accept only true no-drift against the frozen graph, including California
compute, `sjc` bucket placement, variables, networking, groups, and deployment
settings.

Production only: Railway configuration cannot create a new custom domain on a
new service. Register the hostname after foundation and before the first signed
candidate plan. The first command is read-only remotely and writes a private,
canonical intent bound to the exact live web service IDs. The second rechecks
those bytes and the complete source-less topology, creates Railway's generated
service domain first, verifies it, then registers `us.reputationkey.app` and
verifies the exact two-domain readback:

```bash
RAILWAY_DOMAIN_INTENT_DIR="$(mktemp -d)"
pnpm infra:railway:domain -- plan \
  --cell us \
  --deployment-profile production \
  --project-id "<reviewed-production-project-id>" \
  --environment-id "<reviewed-production-cell-us-environment-id>" \
  --intent "$RAILWAY_DOMAIN_INTENT_DIR/us-domain.json"

pnpm infra:railway:domain -- apply \
  --cell us \
  --deployment-profile production \
  --project-id "<reviewed-production-project-id>" \
  --environment-id "<reviewed-production-cell-us-environment-id>" \
  --intent "$RAILWAY_DOMAIN_INTENT_DIR/us-domain.json" \
  --intent-sha256 "<printed-domain-intent-sha256>"

# If apply stopped after either remote create, resume only from the exact
# reviewed probe-only or already-complete state:
pnpm infra:railway:domain -- recover \
  --cell us \
  --deployment-profile production \
  --project-id "<reviewed-production-project-id>" \
  --environment-id "<reviewed-production-cell-us-environment-id>" \
  --intent "$RAILWAY_DOMAIN_INTENT_DIR/us-domain.json" \
  --intent-sha256 "<printed-domain-intent-sha256>"

# After configuring DNS and waiting for Railway issuance, require ACTIVE
# synchronization, verified ownership, and a valid certificate:
pnpm infra:railway:domain -- verify \
  --cell us \
  --deployment-profile production \
  --project-id "<reviewed-production-project-id>" \
  --environment-id "<reviewed-production-cell-us-environment-id>" \
  --intent "$RAILWAY_DOMAIN_INTENT_DIR/us-domain.json" \
  --intent-sha256 "<printed-domain-intent-sha256>"
```

Every domain mode first reruns the complete source-less foundation no-drift
proof, so a same-shaped but manually drifted project cannot receive or verify
the hostname. The apply/recover response includes the generated `probeOrigin` for pre-DNS
health checks and the custom-domain DNS records. Retain it until verify proves
certificate readiness. Verify additionally imports Railway's current
configuration read-only and requires the `web` graph itself to retain exactly
`us.reputationkey.app` on port 8080; a domain-list-only result is insufficient.
The command refuses rehearsal, any hostname except `us.reputationkey.app`, any
port except 8080, a domain state other than empty, exact probe-only, or exact
probe-plus-custom, a runnable application source, unsafe/deleting sync state,
or changed project/environment/service IDs. Delete the private intent directory
after the approved evidence has been retained.

After a signed candidate exists, link `cell-us` in the correct dedicated
project and retain its full-candidate redacted plan:

```bash
pnpm infra:railway:plan-cell \
  --cell=us \
  --deployment-profile=production \
  --manifest=promotion-manifest.json \
  --manifest-sha256="$MANIFEST_SHA256" \
  --evidence-out=docs/release-evidence/beta/<release-id>/raw/cell-us-plan.json
```

For rehearsal, link the separately permissioned project and replace the profile
with `--deployment-profile=rehearsal`; never reuse a production-scoped token.
The command requires an explicit profile. Production refuses any project name
other than `reputation-key-us-beta`; rehearsal requires the distinct
`reputation-key-us-beta-rehearsal` project. Both require exact environment name
`cell-us`. Evidence records the profile, manifest digest, signed controller
digest, observed project name/ID, environment name/ID, IaC digest, raw plan
digest, and outcome, and writes a `shasum -c` compatible sidecar. Exit `0`
means the exact candidate is already no-drift; exit `2` means the reviewed
candidate has pending changes; every other exit blocks. Evidence files use
exclusive creation so recapture cannot replace reviewed evidence.

Railway 5.45.2 includes the canonical evaluated IaC file path in plan JSON.
Capture and execute a release from the same controlled checkout path; moving
the checkout invalidates byte-for-byte plan evidence and requires a fresh plan
and review. Do not weaken the comparison to work around a moved workspace.

Plan values are redacted by default. Never use `--show-values` in retained
evidence. The recorded IaC source-set digest covers `.railway`, the imported
Data Cell catalogue, deployment-profile policy, and project service-isolation
guard; it must equal the digest in the signed release manifest. A serving apply
may consume a reviewed pending full-candidate plan: the controller reruns it,
requires the same raw digest and outcome, and decomposes it into saved plans
that each change exactly one non-destructive service source. It applies each
exact saved plan, waits for the expected digest to reach `SUCCESS`, and
finishes with a no-drift full-candidate plan. Destructive or unrelated changes
always stop the release.

Dry run and apply consume the reviewed candidate-plan artifact and its exact
digest. After apply, recapture a no-drift artifact for independent
verification:

```bash
pnpm release:beta \
  --manifest=<promotion-manifest.json> \
  --signature-bundle=<promotion-manifest.sigstore.json> \
  --manifest-sha256=<manifest-digest> \
  --people-cutover-evidence=<people-evidence.json> \
  --data-cell-cutover-evidence=<data-cell-evidence.json> \
  --data-cell-cutover-evidence-sha256=<data-cell-evidence-digest> \
  --railway-plan-evidence=<cell-us-plan.json> \
  --railway-plan-evidence-sha256=<plan-evidence-digest> \
  --cell=us
```

Before `--apply` enters the audited mutating path, the command verifies the
exact Data Cell evidence digest, rebinds it to a fresh locked live topology
check, checks that the plan's IaC digest equals the signed manifest, and checks
that the plan and current release-controller digests equal the signed manifest
before any Cosign, Railway, or audit side effect. It requires current `railway
status` to match the reviewed project name/ID and environment name/ID exactly.
It also inventories the whole dedicated project, requires `cell-us` to be its
only environment, and requires exactly one instance of every source-managed
service there. It repeats the topology check inside the audited path and after
deployment. For a rehearsal, add its explicit
`--app-url=https://<non-production-host>`; the production hostname is refused.
Production auth always uses
`https://us.reputationkey.app`; before public DNS cutover, an explicit
`--app-url` may name the production service's separate Railway health-probe
origin. Before service promotion, live web and worker `BETTER_AUTH_URL` values
must equal the profile-bound authentication origin. The health-probe override
does not change callback/domain ownership.

## Controlled cutover

Rehearse the complete sequence in `reputation-key-us-beta-rehearsal` before
production:

1. Create the fresh dedicated project and rename its default environment to
   exact `cell-us`. Do not create a second environment, and do not reuse or link
   services from the legacy project.
2. Select deployment profile `rehearsal` and install the environment-scoped
   variables from the approved secret source. Do not attach the production
   custom domain or copy customer credentials/content into the mirror.
3. Render the explicit source-less foundation graph. The repository graph is
   target authority; imported legacy configuration is review input only.
4. Save and review the `cell-us` foundation plan. Any unexpected stateful
   replacement, source change, region change, domain removal, or variable
   deletion stops the cutover.
5. Apply that exact saved, non-destructive foundation plan. Prove `cell-us` is
   the project's only environment and all eight source-managed services have
   exactly one source-less instance there, alongside the exact three managed
   databases, three database volumes, and one object bucket. Remove a root
   `railway*.json` only after Railway no longer reports that file as owner, in
   the same cutover change. `.railway/legacy-config-ownership.ts` must report
   no undeclared or dual-owned serving service.
6. Create the rehearsal web service's Railway-provided domain explicitly;
   [Railway does not assign one automatically](https://docs.railway.com/networking/domains/working-with-domains).
   Use the reviewed opaque IDs and retain the JSON result plus a `domain list`
   read-back:

   ```bash
   railway domain --service web --project <project-id> \
     --environment <environment-id> --json
   railway domain list --service web --project <project-id> \
     --environment <environment-id> --json
   ```

   Set shared `REHEARSAL_APP_URL` to that exact credential-free HTTPS origin.
   The generated service domain is explicit environment-local platform state,
   not a custom domain owned by `.railway/railway.ts`; the release gate still
   requires it to appear on this exact web service. Production does not use
   this raw command: its reviewed domain ceremony creates and returns the probe
   before it creates the custom domain.

7. For the signed candidate, capture and approve the full-candidate plan, then
   run `release:migrate-cell` against its exact artifact and manifest digest.
   The controller creates a private plan that changes only
   `schema-migrator`'s IaC-owned source, applies that same saved plan, and
   requires the one-shot deployment to exit `SUCCESS` at the signed web-image
   digest. Run this for every candidate; it never uploads the working tree.
8. On the first rollout, verify migration `0140` exists and its open control
   row is bound to those same Railway project/environment IDs, then run the
   Data Cell and people-authority cutovers below. For later candidates, verify
   the signed migration head and retain the normal migration result.
9. Recapture and approve the full-candidate plan after migration, then promote
   the seven serving images with `release:beta`. It saves and applies exactly
   one source change at a time and ends no-drift. Web's pre-deploy migration is
   an idempotent recheck. Prove seed-free boot, health, deterministic
   provider-stub journeys, the authorized non-customer Google canary, denied
   dormant-cell execution, backup/restore, fresh Redis recovery, and rollback.
10. For production, create `reputation-key-us-beta` with fresh `cell-us` state,
    apply the exact source-less foundation, and run the reviewed
    `infra:railway:domain` ceremony. It creates the Railway probe
    first and then `us.reputationkey.app`. Use the returned probe origin for
    pre-DNS checks, configure the custom-domain DNS records, and require the
    reviewed domain verify mode before public cutover.
11. Restore the legacy Amsterdam database into production `cell-us`, run the
    isolated restore/recovery fence, then repeat the per-candidate signed
    migration, bounded first-rollout cutovers, and staged full serving
    promotion from steps 7–9. The first promotion graph must retain the already
    registered custom domain without reporting a domain diagnostic.
12. Reconcile people authority and Property routing, promote the signed
    release, then onboard one internal Property before a small beta cohort.
13. Switch the public host only after exact-digest read-back, critical
    journeys, provider checks, and recovery evidence pass. Retain the Amsterdam
    source under the approved rollback/erasure window.

The candidate-migration command is dry-run by default:

```bash
pnpm release:migrate-cell \
  --manifest=<promotion-manifest.json> \
  --signature-bundle=<promotion-manifest.sigstore.json> \
  --manifest-sha256=<manifest-digest> \
  --railway-plan-evidence=<cell-us-plan.json> \
  --railway-plan-evidence-sha256=<plan-evidence-digest> \
  --cell=us
```

After review, choose a new retained evidence path and add `--apply --operator
<registered-operator> --reason "<change-record>" --audit-evidence
<new-migration-authorization.json>`. The existing operator harness checks the
named operator against `OPS_OPERATOR_IDENTITIES`, then exclusively creates a
canonical authorization record and SHA-256 sidecar before any Railway command.
This migration-safe audit boundary deliberately does not open the target
database: a fresh cell may not yet contain `policy_decision_audit`. Never
overwrite or discard the artifact; retain it beside the signed manifest and
plan evidence. Normal `release:beta` remains database-audited. Success means
Railway reports the newly created deployment as `SUCCESS` with the manifest's
web-image digest. The stopped one-shot service is part of `cell-us`; it is not
another Data Cell.

The `europe` and `global` identifiers never represented accepting, provisioned
beta cells, so this policy migration does not copy content out of independent
regional stores. If live inspection
contradicts that assumption, stop: use the operator region-move procedure and a
new decision record instead of the metadata migration.

### `0140` expand fence and bounded operator cutover

Migration `0140_single_us_beta_data_cell` is deploy-safe expansion. It creates
the singleton `data_cell_topology_cutovers` authority in `open/properties`
state and changes no existing tenant, routing, authority, or credential row.
Its trigger backstops serialize these nonterminal workflow admissions through a
share lock on that row:

- a Region Move outside `completed | rolled_back`;
- a canonical Property Data Cell that disagrees with `processing_region`, or a
  relevant Property routing policy newer than version 3;
- a queued/processing legacy or v2 Google import, active legacy effect lease,
  or retryable `temporarily_unavailable` import item;
- an admitted/started Google execution permit;
- an active or ambiguous credential-source, authority-guard, or revoke/cleanup
  operation;
- an unexpired issued credential-broker grant or any `cleanup_only` credential;
- a partial active credential-home tuple, a tuple that does not name the
  Organization's current authority, a future-effective current authority, or
  an exhausted authority/access/credential generation.

The same database boundary refuses a new non-US/policy-3 resolved Property or
current Google credential home while the fence is active and after completion.
Unresolved Properties remain valid for explicit correction. An admission that
already holds the share lock commits before the operator can activate the
exclusive fence; an admission that arrives later waits and then fails closed.
The PostgreSQL concurrency test proves both sides of this ordering.

First produce the report. This is the default and writes nothing:

```bash
pnpm ops:cutover-single-us-data-cell --operator <registered-operator>
```

Retain and review the JSON. It includes all blocker families above, topology
and credential integrity errors, current phase/checkpoints, cumulative
progress/error counts, remaining Property/Organization counts, and a canonical
SHA-256. Do not use an old digest after any durable state changes.

Apply exactly one reviewed transition or batch:

```bash
pnpm ops:cutover-single-us-data-cell <report-sha256> \
  --operator <registered-operator> \
  --ticket <change-ticket> \
  --reason "single-US beta topology cutover" \
  --batch-size 100 \
  --apply \
  --yes ops:cutover-single-us-data-cell
```

The first clean apply only changes `open` to `fenced`; it never edits tenant
rows. If the report names a blocker, drain or reconcile that workflow and run a
new report. Do not edit around the fence. Later applies process no more than the
reviewed batch size (hard maximum 500) in `properties`, then
`credential_homes`, persist the last processed key and counts atomically, and
return the remaining counts. Generate and review a fresh digest before every
invocation. Interruption is safe: rerun the report and resume from the durable
phase/checkpoint. A candidate found below a checkpoint causes a bounded
checkpoint reset rather than being skipped.

The credential phase takes the Organization authority lock, rechecks authority
and connection generation bounds, preserves history, creates at most one new
`legacy_backfill` generation, and invalidates rebound connection access and
credential generations. A typed credential error aborts and rolls back the
entire invocation, including its counters and checkpoints; the previously
committed fence remains in place. Repair the underlying fact, capture a new
report/digest, and retry. An apply never marks completion while any workflow
blocker, topology/credential error, remaining candidate, or persisted operator
error exists.

When the report reaches `fenced/verify`, one final reviewed apply records the
completion digest and changes the control to `completed/completed`. Then write
the immutable evidence file with an exclusive-create path:

```bash
pnpm ops:cutover-single-us-data-cell <reviewed-verify-report-sha256> \
  docs/release-evidence/beta/<release-id>/raw/data-cell-cutover.json \
  --operator <registered-operator> \
  --ticket <change-ticket> \
  --reason "retain verified single-US cutover evidence" \
  --batch-size 100 \
  --apply \
  --yes ops:cutover-single-us-data-cell
```

Evidence creation exclusively locks the control row and repeats a fresh live
check for zero remaining routing work, zero operator errors, and zero topology
or credential-integrity blockers. Ordinary imports/provider work may resume
after completion and does not invalidate a later release readback. The
canonical evidence names only target/progress/digests/operator attribution and
contains no customer content. Promotion requires this exact artifact and
rebinds it to the locked live database preflight before and after service
changes; migration success alone is never cutover evidence.

Also prove the Drizzle journal head is `0140`, run schema-drift verification,
reconcile the remaining unresolved Property report, and exercise denied
`europe` and `global` routes plus completed-state negative Property and
credential-home writes. Existing signed policy-v2 credential directories are
immutable history and fail current-policy validation. The cross-cell broker
stays disabled for beta; publish a newly signed policy-v3 directory only for a
later explicitly approved validation or expansion exercise.

## Dormant-cell and future-expansion contract

Wrong-cell and cross-cell tests remain valuable even though beta deploys one
cell. They ensure a stale `europe`/`global` assignment cannot silently execute
in `us`, and preserve the boundary needed if regional residency is added later.
They are not instructions to provision dormant infrastructure.

Do not rewrite AI `processingRegion: global` records as part of this cutover.
That value belongs to the independently governed AI provider-deployment
profile, not the Property/Railway Data Cell catalogue.

To activate a future cell:

1. Accept a new ADR and catalogue policy defining the residency purpose,
   countries, workloads, legal basis, and rollout owner.
2. Verify current Railway service and bucket identifiers. Bucket placement
   cannot be changed after creation.
3. Add the cell to the explicit deployable-cell list and signed manifest only
   after its environment is intentionally provisioned; unsupported names must
   keep failing closed.
4. Provision isolated state, secrets, domains, backup policy, and exact release
   digests with allocation still denied.
5. Pass restore, provider, journey, wrong-cell, outage, rollback, and data-flow
   evidence for that cell.
6. Rehearse an operator-controlled Property move and source erasure window.
7. Only then allocate countries/workloads and transition the cell to
   `accepting`.

## Remaining blockers before live beta

- Configure scoped Railway and GitHub release-signing credentials, prove GHCR
  pulls, and retain a non-production `cell-us` plan/promotion/read-back.
- Remove legacy Config-as-Code ownership through the controlled cutover.
- Prove live US placement, object-store placement, database backup/PITR,
  isolated restore, fresh-Redis recovery, and timed RPO/RTO.
- Inject a live post-boot dependency loss into each promoted sidecar, retain
  the external alert/replacement evidence, and re-prove that unauthenticated
  traffic cannot reach its protected mTLS listener.
- Verify live domains, email, monitoring, Google, and AI provider configuration
  for the single active cell.

These are one-cell rollout gates. Europe/global provisioning, cross-cell
broker activation, and multi-cell outage evidence are future-expansion work,
not beta blockers.
