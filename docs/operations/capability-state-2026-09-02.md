# Live capability state — 2026-09-02

This is a read-only snapshot of the `google-closed-beta` capability authorities for
Fortunatus EOOD (`Y9gIbVqyl2UfHWlPEZQYhmw4iU2Nvtt8`). PostgreSQL recorded the
observation at `2026-09-02T14:08:17.480Z`.

No database writes were made. Every database statement below is a `SELECT`, and
the PostgreSQL client starts with `default_transaction_read_only=on`.

## Result

There are **24 ON** and **13 OFF** capabilities. All six properties have the same
capability-policy result. No capability is OFF because of a missing tenant row,
a suspension, or `capability_execution_control.denied = true`; all 13 OFF results
are the compile-time `capability_blocked` result.

“Final authority” is the last of the three layers that can refuse the capability
in the observed state:

1. **Compile-time catalogue.** `BLOCKED_CAPABILITIES` refuses before every other
   layer. A non-Google `CORE_CAPABILITIES` entry is attributed to this layer
   because it bypasses tenant allowlisting.
2. **Tenant allowlist.** A non-core capability needs both the Organization row and,
   for a property-scoped decision, that property's row.
3. **Google Content approval.** The four Google capabilities additionally need an
   installed runtime binding, its matching approved row, and an execution-control
   row with `denied = false`.

| Final authority         |     ON |    OFF | Current fact                                                                              |
| ----------------------- | -----: | -----: | ----------------------------------------------------------------------------------------- |
| Compile-time catalogue  |     10 |     13 | 10 non-Google CORE entries pass; 13 BLOCKED entries return `capability_blocked`           |
| Tenant allowlist        |     10 |      0 | Each non-Google, non-core capability has the Organization row and all six Property rows   |
| Google Content approval |      4 |      0 | Four live bindings match approved rows; all four execution controls have `denied = false` |
| **Total**               | **24** | **13** |                                                                                           |

## 37-row truth table

All-property results below mean the capability-policy decision is identical for
all six properties listed later. Product lifecycle can independently make an
archived property unusable; lifecycle is not one of the three capability
authorities measured here.

|   # | Capability                             | State   | Final authority         | Deciding fact or missing fact                                                                                                                                         | Scope                              |
| --: | -------------------------------------- | ------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
|   1 | `activity.use`                         | **ON**  | Compile-time catalogue  | Present in `CORE_CAPABILITIES`; no stop control or Organization suspension                                                                                            | Organization; property-independent |
|   2 | `ai.analyze`                           | **ON**  | Tenant allowlist        | `organization_capability` row plus a `property_capability` row for every property                                                                                     | All 6 properties                   |
|   3 | `ai.detect_trends`                     | **ON**  | Tenant allowlist        | `organization_capability` row plus a `property_capability` row for every property                                                                                     | All 6 properties                   |
|   4 | `ai.generate_reply`                    | **ON**  | Tenant allowlist        | `organization_capability` row plus a `property_capability` row for every property                                                                                     | All 6 properties                   |
|   5 | `badge.use`                            | **OFF** | Compile-time catalogue  | `capability_blocked`; Organization and all six Property rows exist but are filtered and cannot reopen it                                                              | Organization and all 6 properties  |
|   6 | `dashboard.use`                        | **ON**  | Compile-time catalogue  | Present in `CORE_CAPABILITIES`; no stop control or Organization suspension                                                                                            | Organization; property-independent |
|   7 | `gbp.ai.cross_property_summary`        | **OFF** | Compile-time catalogue  | `capability_blocked`; no source edit and recompile has removed the block                                                                                              | Organization and all 6 properties  |
|   8 | `gbp.reply.auto_publish`               | **OFF** | Compile-time catalogue  | `capability_blocked`; no source edit and recompile has removed the block                                                                                              | Organization and all 6 properties  |
|   9 | `gbp.review_solicitation_gamification` | **OFF** | Compile-time catalogue  | `capability_blocked`; no source edit and recompile has removed the block                                                                                              | Organization and all 6 properties  |
|  10 | `goal.use`                             | **ON**  | Tenant allowlist        | `organization_capability` row plus a `property_capability` row for every property                                                                                     | All 6 properties                   |
|  11 | `identity.custom_roles`                | **OFF** | Compile-time catalogue  | `capability_blocked`; no source edit and recompile has removed the block                                                                                              | Organization; property-independent |
|  12 | `identity.invite`                      | **ON**  | Compile-time catalogue  | Present in `CORE_CAPABILITIES`; no stop control or Organization suspension                                                                                            | Organization; property-independent |
|  13 | `identity.register`                    | **OFF** | Compile-time catalogue  | `capability_blocked`; no source edit and recompile has removed the block                                                                                              | Global/Organization                |
|  14 | `inbox.use`                            | **ON**  | Compile-time catalogue  | Present in `CORE_CAPABILITIES`; no stop control or Organization suspension                                                                                            | All 6 properties                   |
|  15 | `integration.use`                      | **ON**  | Compile-time catalogue  | Present in `CORE_CAPABILITIES`; no stop control or Organization suspension                                                                                            | All 6 properties                   |
|  16 | `leaderboard.use`                      | **OFF** | Compile-time catalogue  | `capability_blocked`; Organization and all six Property rows exist but are filtered and cannot reopen it                                                              | Organization and all 6 properties  |
|  17 | `metric.internal`                      | **ON**  | Compile-time catalogue  | Present in `CORE_CAPABILITIES`; no stop control or Organization suspension                                                                                            | Organization; property-independent |
|  18 | `notification.in_app`                  | **ON**  | Compile-time catalogue  | Present in `CORE_CAPABILITIES`; no stop control or Organization suspension                                                                                            | Organization; property-independent |
|  19 | `notification.send_email`              | **ON**  | Tenant allowlist        | `organization_capability` row plus a `property_capability` row for every property                                                                                     | All 6 properties                   |
|  20 | `organization.create`                  | **OFF** | Compile-time catalogue  | `capability_blocked`; no source edit and recompile has removed the block                                                                                              | Global/Organization                |
|  21 | `portal.guest_contact`                 | **OFF** | Compile-time catalogue  | `capability_blocked`; Organization and all six Property rows exist but are filtered and cannot reopen it                                                              | Organization and all 6 properties  |
|  22 | `portal.guest_media`                   | **OFF** | Compile-time catalogue  | `capability_blocked`; Organization and all six Property rows exist but are filtered and cannot reopen it                                                              | Organization and all 6 properties  |
|  23 | `portal.guest_response`                | **ON**  | Tenant allowlist        | `organization_capability` row plus a `property_capability` row for every property                                                                                     | All 6 properties                   |
|  24 | `portal.guest_text`                    | **ON**  | Tenant allowlist        | `organization_capability` row plus a `property_capability` row for every property                                                                                     | All 6 properties                   |
|  25 | `portal.public_read`                   | **ON**  | Tenant allowlist        | `organization_capability` row plus a `property_capability` row for every property                                                                                     | All 6 properties                   |
|  26 | `portal.read`                          | **ON**  | Tenant allowlist        | `organization_capability` row plus a `property_capability` row for every property                                                                                     | All 6 properties                   |
|  27 | `portal.upload`                        | **OFF** | Compile-time catalogue  | `capability_blocked`; Organization and all six Property rows exist but are filtered and cannot reopen it                                                              | Organization and all 6 properties  |
|  28 | `portal.write`                         | **ON**  | Tenant allowlist        | `organization_capability` row plus a `property_capability` row for every property                                                                                     | All 6 properties                   |
|  29 | `property.connect_gbp`                 | **ON**  | Google Content approval | CORE bypasses allowlisting; live binding matches approved row `968a7e52-841d-480c-961c-3e5fa66680d3`; execution control is `denied = false`                           | All 6 properties                   |
|  30 | `property.create`                      | **ON**  | Compile-time catalogue  | Present in `CORE_CAPABILITIES`; no stop control or Organization suspension                                                                                            | Organization; property-independent |
|  31 | `property.erase`                       | **OFF** | Compile-time catalogue  | `capability_blocked`; no source edit and recompile has removed the block                                                                                              | All 6 properties                   |
|  32 | `property.import_gbp_v2`               | **ON**  | Google Content approval | Organization + all six Property rows; live binding selects latest matching approved row `35ec7d31-5613-4ef7-8605-afc87cf9d88d`; execution control is `denied = false` | All 6 properties                   |
|  33 | `property.publish_reply`               | **ON**  | Google Content approval | CORE bypasses allowlisting; live binding matches approved row `baf1aa58-37c1-4bf4-ad95-663d69142076`; execution control is `denied = false`                           | All 6 properties                   |
|  34 | `property.read_gbp_performance`        | **ON**  | Google Content approval | Organization + all six Property rows; live binding selects latest matching approved row `92aad3a1-904a-40cc-91f9-7202ce69046c`; execution control is `denied = false` | All 6 properties                   |
|  35 | `review.use`                           | **ON**  | Compile-time catalogue  | Present in `CORE_CAPABILITIES`; no stop control or Organization suspension                                                                                            | All 6 properties                   |
|  36 | `staff.use`                            | **ON**  | Compile-time catalogue  | Present in `CORE_CAPABILITIES`; no stop control or Organization suspension                                                                                            | Organization; property-independent |
|  37 | `team.use`                             | **OFF** | Compile-time catalogue  | `capability_blocked`; Organization and all six Property rows exist but are filtered and cannot reopen it                                                              | Organization and all 6 properties  |

## Scope and policy rows

The Organization is in cohort `railway-closed-beta-1` and is not suspended.
Neither `web` nor `worker` has `BETA_CAPABILITIES_OFF`, `BETA_SUSPENDED_ORGS`,
`BETA_ALLOWLIST_ORGS`, or `BETA_E2E_GLOBAL_CAPABILITIES` set.

Each property has the same 18 persisted rows: the 12 promotable non-core
capabilities plus six now-blocked capabilities (`badge.use`, `leaderboard.use`,
`portal.upload`, `portal.guest_contact`, `portal.guest_media`, and `team.use`).
The same 18 rows exist at Organization scope.

| Property                                 | ID                                     | Lifecycle | `property_capability` rows | Suspension fact                                            |
| ---------------------------------------- | -------------------------------------- | --------- | -------------------------: | ---------------------------------------------------------- |
| Hotel Elegance                           | `071b20fe-2598-4f63-a2a1-b9ac2f959575` | active    |                         18 | No `property_policy` row; therefore not suspended          |
| Studio Priority                          | `8d79a13e-e56b-4b43-9f69-86d53c137d31` | active    |                         18 | No `property_policy` row; therefore not suspended          |
| Urban Move                               | `14e312ca-db4e-4892-af51-e51ce1e39da4` | active    |                         18 | Row exists; `suspended_at` and `suspended_reason` are null |
| А+ частна чуждоезикова школа и занималня | `f3cd2070-e2d0-4ddd-803e-db17401f1a6e` | archived  |                         18 | No `property_policy` row; therefore not suspended          |
| А+ чуждоезикова занималня                | `363b2482-0b40-46cb-9764-c12d7c17ce7a` | active    |                         18 | No `property_policy` row; therefore not suspended          |
| А+ чуждоезикова школа                    | `3ba5f20c-3ff5-4061-b8ed-5d70824d8133` | active    |                         18 | No `property_policy` row; therefore not suspended          |

The ticket requested `cohort` from both policy tables. The live
`property_policy` table has no `cohort` column; the real column exists only on
`organization_policy`, matching `src/shared/db/schema/policy.schema.ts:34-64`.

## Google Content authority

The installed four-binding set pins this common tuple:

- `release_sha = 5fafeae95fbe951038af31cc143c388ccc116060`
- `route_catalog_version = 2026-08-27`
- `capability_policy_version = beta-local-2`
- `migration_head = 0042_google-import-execution-policy-version`
- `railway_closed_beta_cohort = [Y9gIbVqyl2UfHWlPEZQYhmw4iU2Nvtt8]`
- `approved_at = 2026-09-02T10:23:55.889Z`
- `expires_at = 2026-10-01T10:23:55.889Z`

`loadApprovalForRuntime` selects the latest full-tuple match by
`binding_version`; these are the four selected rows:

| Capability                      | Approval row ID                        | Binding version | Status   |
| ------------------------------- | -------------------------------------- | --------------: | -------- |
| `property.connect_gbp`          | `968a7e52-841d-480c-961c-3e5fa66680d3` |               1 | approved |
| `property.import_gbp_v2`        | `35ec7d31-5613-4ef7-8605-afc87cf9d88d` |              13 | approved |
| `property.publish_reply`        | `baf1aa58-37c1-4bf4-ad95-663d69142076` |               1 | approved |
| `property.read_gbp_performance` | `92aad3a1-904a-40cc-91f9-7202ce69046c` |              13 | approved |

All execution-control timestamps that indicate denial/draining are null:

| Capability                      | `denied` | `denied_at` | `drained_at` | `emergency_kill_version` |
| ------------------------------- | -------- | ----------- | ------------ | -----------------------: |
| `property.connect_gbp`          | false    | null        | null         |                       25 |
| `property.import_gbp_v2`        | false    | null        | null         |                       25 |
| `property.publish_reply`        | false    | null        | null         |                       25 |
| `property.read_gbp_performance` | false    | null        | null         |                       25 |

`policy_version` has one row: `scope = global`, `version = 62`,
`emergency_kill_version = 25` (updated `2026-09-02T11:40:37.545Z`).

## Raw row counts

These are direct counts, not counts inferred from the truth table.

| Read set                                                           | Rows |
| ------------------------------------------------------------------ | ---: |
| Organizations in the database                                      |    1 |
| Properties for the Organization                                    |    6 |
| `organization_capability`                                          |   18 |
| `property_capability`                                              |  108 |
| `organization_policy`                                              |    1 |
| `property_policy`                                                  |    1 |
| `capability_compliance_approvals` for the four Google capabilities |   28 |
| `capability_execution_control` for the four Google capabilities    |    4 |
| `policy_version`                                                   |    1 |

The 28 approval rows break down as 1 `property.connect_gbp`, 13
`property.import_gbp_v2`, 1 `property.publish_reply`, and 13
`property.read_gbp_performance`. The other 24 are historical binding versions;
they do not replace the latest full-tuple matches selected by the live bindings.

## Reproducible read command

The Postgres16 service has neither `RAILWAY_TCP_PROXY_DOMAIN` /
`RAILWAY_TCP_PROXY_PORT` variables nor a Railway TCP proxy. The working path is
a one-shot command through the deployed `web` container. The named SSH key must
already be registered with Railway; no key material is stored here.

```sh
RAILWAY_CALLER=skill:use-railway@1.3.7 \
RAILWAY_AGENT_SESSION=railway-cap-state-404-20260902 \
railway ssh \
  --project 91ab4b88-25a1-404c-9961-4f2b392e2874 \
  --service web \
  --environment google-closed-beta \
  --identity-file "$HOME/.ssh/repkey_google_closed_beta_approval_ops" \
  node -e '
const { Client } = require("pg");
const queries = new Map([
  ["session", `SELECT current_database() AS database, current_user AS role, current_setting($$default_transaction_read_only$$) AS default_transaction_read_only, clock_timestamp() AS observed_at`],
  ["organizations", `SELECT id, name, slug FROM organization ORDER BY id`],
  ["properties", `SELECT id::text AS property_id, organization_id, name, slug, lifecycle_state, deleted_at FROM properties ORDER BY organization_id, name, id`],
  ["organization_capability", `SELECT organization_id, capability, created_by, created_at FROM organization_capability ORDER BY organization_id, capability`],
  ["property_capability", `SELECT property_id::text AS property_id, capability, created_by, created_at FROM property_capability ORDER BY property_id, capability`],
  ["organization_policy", `SELECT organization_id, cohort, suspended_at, suspended_reason, updated_at FROM organization_policy ORDER BY organization_id`],
  ["property_policy", `SELECT property_id::text AS property_id, suspended_at, suspended_reason, updated_at FROM property_policy ORDER BY property_id`],
  ["capability_compliance_approvals", `SELECT id::text AS id, capability::text AS capability, status::text AS status, approved_at, expires_at, binding_version, release_sha, route_catalog_version, capability_policy_version, migration_head, railway_closed_beta_cohort FROM capability_compliance_approvals WHERE capability::text IN ($$property.connect_gbp$$, $$property.import_gbp_v2$$, $$property.publish_reply$$, $$property.read_gbp_performance$$) ORDER BY capability, binding_version`],
  ["capability_execution_control", `SELECT capability::text AS capability, denied, denied_at, drained_at, cleanup_drained_at, emergency_kill_version::text AS emergency_kill_version, reason, updated_at FROM capability_execution_control WHERE capability::text IN ($$property.connect_gbp$$, $$property.import_gbp_v2$$, $$property.publish_reply$$, $$property.read_gbp_performance$$) ORDER BY capability`],
  ["policy_version", `SELECT scope, version::text AS version, emergency_kill_version::text AS emergency_kill_version, updated_at FROM policy_version ORDER BY scope`],
  ["raw_counts", `SELECT (SELECT count(*)::int FROM organization_capability) AS organization_capability, (SELECT count(*)::int FROM property_capability) AS property_capability, (SELECT count(*)::int FROM organization_policy) AS organization_policy, (SELECT count(*)::int FROM property_policy) AS property_policy, (SELECT count(*)::int FROM capability_compliance_approvals WHERE capability::text IN ($$property.connect_gbp$$, $$property.import_gbp_v2$$, $$property.publish_reply$$, $$property.read_gbp_performance$$)) AS capability_compliance_approvals_google, (SELECT count(*)::int FROM capability_execution_control WHERE capability::text IN ($$property.connect_gbp$$, $$property.import_gbp_v2$$, $$property.publish_reply$$, $$property.read_gbp_performance$$)) AS capability_execution_control_google, (SELECT count(*)::int FROM policy_version) AS policy_version`],
]);
(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    options: "-c default_transaction_read_only=on",
    application_name: "capability-state-readback-404",
  });
  await client.connect();
  try {
    for (const [name, sql] of queries) {
      const result = await client.query(sql);
      console.log(JSON.stringify({ name, rowCount: result.rowCount, rows: result.rows }));
    }
  } finally {
    await client.end();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
'
```

The command contains no database host, connection string, password, token, or
key. `DATABASE_URL` is consumed only inside the Railway container.

## What surprised me

Nothing in this read contradicts map #403's starting facts: there are 37
capabilities (12 CORE, 13 BLOCKED, 12 promotable non-core), all four Google
capabilities are ON, their binding tuple still pins `5fafeae9` /
`beta-local-2` / migration `0042`, and Postgres still has no public proxy.

Three details were still notable:

- Six now-blocked capabilities retain allowlist rows at Organization scope and
  on every Property. The compile-time filter correctly makes all 42 stale rows
  powerless.
- There are 28 still-`approved` Google approval rows for four capabilities, not
  four rows total. Runtime selection by the full tuple and greatest
  `binding_version` is therefore essential.
- Only Urban Move has a `property_policy` row, and one of the six properties is
  archived. Neither fact changes the capability-policy result: all suspension
  fields are null, and lifecycle is a separate authority.
