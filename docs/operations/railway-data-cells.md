# Railway Data Cell topology and cutover

Status: target contract authored; live cutover not applied  
Owner: Platform/Operations  
Authority: `REG-02` in `docs/comprehensive-beta-implementation-program-2026-08-25.md`

## Target topology

RepKey uses one production Railway project and one separately permissioned
non-production mirror. Both projects use the same three long-lived environment
names and the same `.railway/railway.ts` graph:

| Environment   | Logical cell | Services/databases                 | Bucket          | Public host                |
| ------------- | ------------ | ---------------------------------- | --------------- | -------------------------- |
| `cell-us`     | `us`         | California `us-west2`              | San Jose `sjc`  | `us.reputationkey.app`     |
| `cell-europe` | `europe`     | Amsterdam `europe-west4-drams3a`   | Amsterdam `ams` | `eu.reputationkey.app`     |
| `cell-global` | `global`     | Singapore `asia-southeast1-eqsg3a` | Singapore `sin` | `global.reputationkey.app` |

Every environment has the same names and graph:

- `web` and singleton `worker`;
- `Postgres` and queue/cache `Redis`;
- private `object-store` bucket;
- distinct, volume-free `google-provider-redis` service for short-lived
  provider material;
- `google-egress-gateway` and `google-execution-admission`;
- `ai-egress-gateway` and `ai-execution-admission`.

Provider Redis is a signed RepKey release image on private Railway networking,
with no public TCP proxy or volume. It binds only TLS port 6380, disables RDB,
AOF, and replication, uses bounded `noeviction` memory, disables the default
user, and denies persistence/admin commands to its dedicated ACL identity. The
environment-scoped `PROVIDER_EPHEMERAL_REDIS_URL` must be
`rediss://<non-default-user>:<secret>@google-provider-redis.railway.internal:6380`;
the private CA is supplied separately. The main queue/cache Redis continues to
use Railway private networking. Bucket references use Railway's `BUCKET`,
`ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `REGION`, and `ENDPOINT` outputs. Railway
buckets use virtual-hosted addressing, so `S3_FORCE_PATH_STYLE=false`.

No runtime service source is declared in IaC. The graph owns resources,
placement, variables, domains, build/deploy settings, and process boundaries.
`REG-03` owns the exact immutable image digest through the signed release
manifest, including provider Redis. Adding a GitHub source or mutable image tag to the graph would restore
per-cell rebuilding and is prohibited.

## Current live-state exception

The existing `reputation-key` project is not the target topology:

- `production` has only PostgreSQL and Redis in Amsterdam;
- `google-closed-beta` and `staging` combine application and non-production
  support services in Amsterdam;
- service Config-as-Code still points at the repository's `railway*.json`
  files.

This is migration input, not a valid multi-cell production layout. Do not run a
destructive IaC apply against those environments. Railway refuses dual
ownership while a service is managed by `railway.json`; that guard is useful.
The legacy files remain only until the reviewed cutover below because deleting
them first would make the currently linked services lose their active config.

## Variable ownership and exposure

Never place a secret value in `.railway/railway.ts`. The graph contains only
resource references, non-secret fixed contract values, and references to
Railway shared variables.

| Owner              | Variable families                                                                                                                            | Rotation/cutover rule                                                                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Railway/Platform   | database, Redis, and bucket outputs                                                                                                          | created per environment; immutable bucket region; rotate bucket credentials under a dual-read credential window                                                                                                          |
| Security           | `BETTER_AUTH_SECRET`, encryption/OAuth/Portal/notification-unsubscribe HMACs, Google/AI mTLS material, admission/provenance signing material | versioned keyrings where supported; share `NOTIFICATION_UNSUBSCRIBE_HMAC_KEYS` only between web/worker in one cell, use distinct keys per cell, and issue separate web, worker, gateway, and admission leaf certificates |
| Google integration | OAuth client, Pub/Sub identity/topic, Content runtime bindings/role public keys, admission database URL/CA                                   | OAuth client may be common, but credentials/bindings are installed per cell; admission DB URL uses the dedicated execute-only role, never the database owner URL                                                         |
| AI integration     | `OPENAI_API_KEY`, key inventory/profile digests, admission/provenance keys                                                                   | OpenAI key reaches only the AI gateway; admission private key reaches only AI admission; property capabilities remain off until authorization evidence passes                                                            |
| Operations         | Resend, Sentry, alert webhook, metrics token, operator identities                                                                            | named owner; verify sending domain and Germany-hosted Sentry before customer traffic                                                                                                                                     |
| Release controller | `RELEASE_SHA`, `RELEASE_MANIFEST_SHA256`; image-baked `IMAGE_SOURCE_REVISION`                                                                | the signed manifest, active image digest, runtime release SHA, and baked source revision are one release fact; service-level source-revision overrides are forbidden                                                     |

Process boundaries are executable tests:

- web never receives `REVIEW_PROVIDER_SUBJECT_HMAC_KEYS` or
  `AI_SUBJECT_HMAC_KEYS`;
- web and worker use different Google and AI client certificates;
- admission/gateway services receive their exact allowlisted variable names;
- Google mTLS uses base64 variables on Railway and never depends on an
  undocumented `/run/repkey` secret mount;
- Google admission and AI admission use dedicated role URLs supplied as
  shared secrets rather than `Postgres.DATABASE_URL` owner credentials.

## Validation

Run the offline contract before requesting a Railway plan:

```bash
pnpm infra:railway:validate
pnpm typecheck
```

The contract test renders all three graphs and proves logical/physical
placement, bucket placement, domains, no default region, exact sidecar
allowlists, distinct process credentials, worker-only secrets, resource
references, health activation, drain budgets, and the migrated service config.

After the target project and environment-scoped CI tokens exist, link one
environment at a time and capture the redacted drift plan:

```bash
railway config plan --file .railway/railway.ts --detailed-exit-code --json
```

Exit `0` means no drift, `2` means reviewed changes are pending, and any other
exit blocks promotion. Never use `--show-values` in CI or evidence. Store the
redacted JSON and its SHA-256 beside release evidence. Applying is a separate
operator action; destructive changes require an explicit plan review and must
not be hidden in an automatic rollback.

## Controlled migration from service Config-as-Code

For the non-production mirror first:

1. Create the separate project and the three empty `cell-*` environments.
2. Install environment shared variables from the approved secret source. Do
   not copy customer credentials or content from the legacy project.
3. Import/migrate existing service config into the one graph only as a review
   aid. Compare it with `.railway/railway.ts`; the repository graph is the
   target authority.
4. Plan each environment. A replacement of an existing stateful resource,
   region change, custom-domain removal, or variable deletion is destructive
   and stops the cutover.
5. Apply the reviewed non-destructive graph. Only after Railway no longer
   reports a Config File owner, remove the corresponding `railway*.json` files
   in the same cutover change. There must be no steady-state dual ownership.
6. Attach the exact candidate image digests through the `REG-03` promotion
   controller, run migrations once, and keep Property allocation/traffic off.
7. Prove seed-free boot, startup/readiness/liveness, provider sandbox journeys,
   wrong-cell denial, backup/restore, and operation with either other cell
   offline.
8. Onboard one internal Property in the mirror, then one internal Property in
   the production cell. The Data Cell catalogue may change from `provisioning`
   to `accepting` only after that cell's evidence is approved.

Repeat production one cell at a time. Do not migrate the legacy database by
renaming or re-regionalizing it in place. Restore/cut over into the target cell
under the `REG-01` data-move fence and `REG-04` recovery procedure.

## New-cell checklist

A fourth cell is not added by copying an environment in the dashboard:

1. Add one explicit entry to `.railway/cell-topology.ts`; unsupported names
   must continue to throw rather than default.
2. Verify current Railway service and bucket region identifiers from official
   documentation. Bucket placement is immutable after creation.
3. Add the domain/TLS and routing-token contract; no host may fall back to
   another cell.
4. Extend the signed Data Cell catalogue and country/workload policy in
   `REG-01`; initial state is `provisioning`.
5. Render and review the offline graph, then the remote redacted plan.
6. Provision empty state, dedicated process credentials, migrations, and
   exact release digests.
7. Complete restore/provider/journey/wrong-cell/failure drills with allocation
   still denied.
8. Record approval and only then transition the cell to `accepting`.

## Known blockers before live apply

- The authoritative catalogue and fail-closed router have landed. Europe and
  Global remain in `provisioning`. Property assignment is now canonical and
  database-guarded. Process-local HTTP/server-function, property repository,
  worker/queue, outbox transport, provider, portal object-storage, operator,
  and restore-source fences now deny wrong-cell execution. A live cross-cell
  fault drill and cell-local backup/PITR evidence are still required before
  either provisioning cell can accept work.
- The signed digest-promotion implementation has landed, but it is not yet live
  evidence. Configure the protected `release-signing` GitHub environment,
  confirm Railway can pull the GHCR packages, run the workflow from `main`, and
  perform a non-production `cell-*` promotion/read-back drill before production
  cutover. See `immutable-release-promotion.md`.
- Railway project/environment tokens for PR drift checks are not yet installed.
  CI cannot honestly claim remote drift is green until those scoped secrets
  exist.
- Sidecars expose protected mTLS readiness only. A normal platform-health port
  that does not weaken the protected listener remains required before a clean
  Railway cell can prove ongoing readiness.
- The `REG-04` recovery fence has landed: restore target admission, durable
  per-cell recovery generations, overdue-retention reconciliation, restored
  session/invitation/provider/AI/job authority invalidation, and unpublished
  outbox fencing are integration-proven. Live per-cell PITR, signed-image read
  verification, fresh-Redis cutover/rollback, and timed RPO/RTO evidence remain
  blockers before a provisioning cell can accept work.

These blockers are fail-closed rollout gates, not reasons to collapse cells or
silently route Europe/Global through US.
