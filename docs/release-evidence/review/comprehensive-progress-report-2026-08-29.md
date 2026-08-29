# Comprehensive implementation progress report

**Assessment date:** 2026-08-29
**Branch:** `codex/comprehensive-program-continuation`
**Supersedes:** [`comprehensive-progress-report-2026-08-28.md`](comprehensive-progress-report-2026-08-28.md)
**Plan:** [`docs/program-completion-plan-2026-08-28.md`](../../program-completion-plan-2026-08-28.md)
**Backlog:** [`program-completion-backlog-2026-08-28.json`](program-completion-backlog-2026-08-28.json)

## What changed since 2026-08-28

The 2,447-path uncommitted tree is gone. It is now 34 path-scoped commits plus
seven implementation waves, all on one branch, all pushed. The three-axis ledger
counts are unchanged in shape — and that is the point of the model, not a
failure of the work.

| Measure                        | 2026-08-28 | 2026-08-29 |
| ------------------------------ | ---------- | ---------- |
| Implementation complete        | 36 / 42    | 36 / 42    |
| Repository verification passed | 0 / 42     | 0 / 42     |
| Formally closed                | 0 / 42     | 0 / 42     |
| Uncommitted working-tree paths | 2,447      | **0**      |
| TypeScript modules             | 3,729      | 4,073      |
| Unit tests                     | 10,902     | 12,256     |
| Integration tests              | 1,034      | 1,279      |
| Migrations                     | 169        | 175        |

The six open packages all advanced substantially, but none crossed to
`complete`, and no package can pass repository verification until one immutable
candidate is frozen. The ledger says so, and the validator enforces it.

## The tree is no longer the largest risk

The 2026-08-28 report named the uncommitted tree as the largest immediate
delivery risk. It is resolved: 34 attributable commits by concern, then one
commit per wave-concern, branch pushed, pull request open. Only the series tip
is a verified state; intermediate commits are integration checkpoints.

## What landed

### The development database, diagnosed and fenced

`repkey_dev` is **forked**, not behind: five applied migrations have hashes no
current repository file produces, the ledger diverges from the journal at
ordinal 25, and 57 migrations are unapplied. The reported already-exists column
was a consequence. The recommendation is recreation, not reconciliation —
hand-editing the ledger would produce a database claiming a lineage it does not
have.

The hole is closed structurally. `ConfiguredDatabaseFence` refuses any target
matching a connection string in this checkout's own env files, before a
connection is opened, with no override.

### `LIF-01` — from one contributor to the whole lifecycle

All seventeen export contributors and all seventeen destructive lifecycle
contributors exist on one frozen protocol. Migration 0170 made the
post-upload/pre-completion crash window recoverable, so export generation is no
longer hard-fenced. The backup-erasure ledger and restore resurrection fence,
operator-only Property Erase, privacy access/correction/withdrawal/erasure, the
report-only retention registry, the Closure Center, explicit reactivation,
transfer-first leave and the Purge Pending final notice all exist.

The destructive contributor set is assembled and proved complete **and
deliberately not composed into the default container**. Readiness reporting
seventeen missing contexts is the honest state: destructive activation waits for
crash recovery, backup fencing and counsel-approved retention.

### `ARC-03` — the composition root

Under 1,000 lines. Process-global ExecutionPolicy, DelayedExecutionPolicy,
CapabilityPolicyStore and the outbox consumer registry are container-owned with
one explicit process installation. Late-bound build-order cycles are replaced by
named ports with contract tests. Each deployable builds exactly one Application
Container, proved by independently spawned process fixtures.

### `LEG-01` — counsel approval made mechanical

Five documents, five drafts, zero approvals, three publication blockers — the
output of `pnpm check:legal-registry`, which runs on push. The authority refuses
post-approval drift, a stale draft digest, an approver who is not external
counsel, self-approval, expiry, an unregistered document, and approving a
document while a decision blocking it is open. Gate F's legal fail-open is
closed. See [ADR 0060](../../adr/0060-machine-checked-legal-approval.md).

### `REL-01` — producers that refuse

Every Gate F evidence key has a producer that fails closed. The canary observer
currently exits non-zero because the observation-window duration in ADR 0059 is
an operating owner's decision, not engineering's. That is the correct state.

### `IBX-01` and `CNV-01`

Inbox has the legacy classification contract and read-only parity report, the
complete handling record, the fresh-database replay matrix, reminder time-travel
evidence, and `inbox_items.status` cut to read-only-retained. Contraction has
the inventory registry proving every candidate table has exactly one read-only
command, plus the non-FK scanner and reachability harness. **No physical
contraction has been performed.**

## Independent review — 9 confirmed findings

Five independent read-only lenses reviewed the new surfaces; every finding then
faced an adversarial refutation pass whose default verdict is refuted. Of 25
candidates, **9 survived**. Full record:
[`independent-review-2026-08-29.json`](independent-review-2026-08-29.json).

### Fixed in this wave

- **CRITICAL — the Closure Center could permanently brick a tenant.** Requesting
  a closure commits an Organization-wide suspension; cancelling deliberately
  leaves it in place with the reactivation fence set; and reactivation was
  impossible in both composition (no probes bound) and the database (migration
  0159 permits no `active → active` edge). One click by any AccountAdmin on a
  live route would have suspended the tenant with no in-product recovery.
  `requestClosure` now refuses when the deployment cannot reactivate. Arming a
  suspension whose only exit is not composed is now impossible.
- **LOW — the entry-point catalogue recorded a false safety property**, claiming
  cancellation clears the suspension. It does not, by design. The note now says
  what the code does.
- **LOW — Gate F role separation was declared but not enforced.**
  `GATE_F_ENGINEERING_ROLES` had zero consumers, so one keypair enrolled for
  both `security` and `counsel` would have satisfied both approvals. The role
  key map now refuses a key enrolled for two roles, and names the
  engineering/counsel collision explicitly.

### Open, recorded, not fixed

These are real and should be scheduled before a candidate freeze. None is
reachable in a default container today.

| Severity | Finding                                                                                                                                                                                                                                                                                             |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HIGH     | The backup-erasure ledger lives inside the database it fences. A PITR restore rolls the ledger back with everything else, so the fence reads an empty ledger and reports `verified: true`. Latent: nothing calls the fence during a restore yet. Needs an out-of-cell copy or a pre-restore export. |
| HIGH     | Export `delete_pending` is a dead end: a crash or transient object-store error between the claim and the delete strands the tenant archive in the bucket.                                                                                                                                           |
| MEDIUM   | `runPhase` opens 17 concurrent transactions on a 10-connection pool, exceeding the pinned per-job budget.                                                                                                                                                                                           |
| MEDIUM   | Gate F accepts a bundle where the approved legal bytes and the on-disk legal bytes disagree, if the checklist digest is rewritten to match.                                                                                                                                                         |
| LOW      | The Property Erase job header claims a crash resumes from receipts, but the pass is one transaction, so a crash discards them.                                                                                                                                                                      |

## Verification

Run under Node 22.23.2 at the series tip:

| Gate        | Result                                                          |
| ----------- | --------------------------------------------------------------- |
| Typecheck   | 3 projects / 4,073 modules                                      |
| Lint        | including architecture, filename, component, Zod, product-state |
| Format      | clean                                                           |
| Unit        | 1,262 files / 12,256 passed / 6 skipped                         |
| Integration | 239 files / 1,279 passed, on a database created from scratch    |

One integration run on a **reused** database showed a single failure that
disappeared on a brand-new one — the same reuse contamination the 2026-08-28
report documented. The fresh run is authoritative.

Governance controls caught real regressions at every wave and were answered
rather than relaxed: browser reachability (a `node:crypto` import reachable from
the Inbox public API), the entry-point catalogue order digest, the
operator-command classifier, the Team quarantine, the Recognition surface
inventory, the dark-context properties-table watch, filename and type-triple
variances, a banned observability key, and a double-serialized route payload.

## Continuous integration: first run on this branch

CI had never run on this work — it lived in an uncommitted tree. The first runs
therefore surfaced a backlog of failures at once. Fixed so far:

- **Docker and e2e image builds.** The artifact gate refuses any Google import
  compatibility path in the final worker artifact. The wave-6 Integration
  lifecycle contributor named three compatibility mirrors directly and a
  catalogue note spelled out two more. Those mirrors belong to the compatibility
  build; the contributor defers them and its purge receipt now says so, because
  a partial purge that stays silent reads as complete.
- **Simulation.** The scenario builder created reviews with a null content
  clock, which took a compatibility path that writes no material review
  revision, so every reply and Inbox item fenced by that foreign key failed. The
  builder now takes the production observation route.
- **A real production defect the simulation exposed.** `ARC-03-T12` surfaced
  Notification's delivery capability but left `deliverySettlement` behind, so
  the worker's insert-notification handler was built without it and every
  outbox-delivered notification threw.
- **Three Inbox Storybook stories** that regressed in this session, confirmed
  against the pre-session tree where they passed.

### The rest of the backlog, diagnosed

Everything below was still red when the first list was written. Each one had a
cause, and in every case the gate was right.

**`simulate` — the simulation was answering to another container.** ARC-03-T8
made the ExecutionPolicy, DelayedExecutionPolicy and CapabilityPolicyStore the
answer of exactly one named owner per process. The web, worker and operator
processes each name theirs; the simulation named none, so the first
policy-gated read inside an event handler fell through to the WEB cold-boot
fallback, which builds a SECOND container from ambient environment. With a
developer's `.env` present that build succeeded and the simulation silently
decided against a different container's audit sink. In CI, which sets only the
eight variables the job declares, it threw — so every handler threw, no Inbox
item was ever created, and the container was rebuilt on every single event: 78
boots in one run. `createSimulationContainer` now binds its own. Proven by a
spawned-process fixture, because a shared vitest worker cannot show it.

**`docker` — the AI egress boundary was linking a monitoring SDK.** The image
gate refuses an AI bundle containing `node_modules/@sentry/`, because those two
sidecars decide what may leave the cell and an SDK opening its own outbound
connection from inside that decision is a hole in it. The sidecar runtime
hardening imported telemetry at module scope for a default, and `noExternal`
bundles everything reachable. The monitoring client is a required parameter
now, with a Sentry-free implementation for the AI pair, and a graph walk that
fails in milliseconds instead of after a docker build.

**`e2e` — the Google admission image could not be parsed.** The tsup banner
declared `import { createRequire } from 'node:module'`, and esbuild hoisted a
bundled dependency's own `createRequire` import beside it: two top-level
declarations of one name, and the container exited 1 on a `SyntaxError` before
a test ran. Every banner now imports under a name no source can use, and the
Google bundle verifier does what the AI one always did — `node --check` on the
artifact, so a bundle that cannot parse fails the build rather than the
container. The failure after that was silent, which was its own defect: the
startup boundary handed the error to a monitoring client that is switched off
outside a deployed cell. It writes to stderr first now.

**`storybook-test` — three real defects and one race, not "flaky tests".** The
public portal painted its CTA with the tenant's brand colour and hardcoded
white text: 1.99:1 on the Dark palette preset, and 4.47:1 — below AA — on the
default indigo. The language links inherited app chrome at 3.88:1. The Inbox
filter popover and its Select were an unnamed `role="dialog"` and an unnamed
`role="listbox"`. One story asserted a tab list that the domain had correctly
grown. The remainder were a genuine race: while a Radix overlay is open or
closing it marks the rest of the page `aria-hidden` and animates content in
from `opacity: 0`, so a query issued in the next tick sees neither. 553/553.

**`check` — two masked failures.** `lint:ci` rejects a bare `.toThrow()`, and
three had landed; eslint failing first in the same chain had been hiding them.
Each names its error now, two of them by Postgres code on the wrapped cause,
because Drizzle replaces the message. Separately a containment test scanned
`src/shared/projections`, retired on this branch but still present locally as
an empty untracked folder — it read something here and nothing on a fresh
checkout.

Still red, with corrected attribution:

| Job      | Cause                                                                                                                                                                                                                         | Attribution                                                                                                                                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit`  | **Correction.** The earlier entry called this a property of the diff. It is not: Fallow reports `introduced` separately from `inherited`, and 501 of the findings are introduced — 241 dead code, 235 complexity, 24 styling. | This branch's own debt. Most of the dead exports are surfaces built ahead of composition (the destructive lifecycle contributors are deliberately uncomposed); separating those from genuinely dead code is per-symbol work. |
| `docker` | A base-image CVE published after the pin. `redis:7.4.7-alpine` is eight packages behind, including OpenSSL 3.3.6 → 3.3.7.                                                                                                     | Not this branch. Needs a digest bump to the newest `redis:7.4-alpine` build and a rerun of the scan to confirm — the practice `.grype.yaml`'s own header describes.                                                          |
| `e2e`    | The Google execution admission sidecar refuses its Redis at boot — see below. It never started on this branch, so no e2e test has run against these images.                                                                   | This branch. The sidecar and its compose wiring are both new here; they disagree with each other.                                                                                                                            |
| `CodeQL` | Open alerts on the repository, most predating this branch (`js/insecure-randomness` in e2e specs, `js/request-forgery` in the control proxy, `js/file-system-race` in the local stack).                                       | Mixed. The three this branch owned — the LIKE escaping, the shared-secret key derivation, the artifact write races — are fixed and their threads resolved.                                                                   |

**Correction to the earlier `storybook-test` row.** It called the failures
pre-existing. Ten of the twelve failing story files were new or substantially
changed on this branch; only two were untouched. They were this branch's, and
they are fixed.

### `e2e`: the specified fix, not attempted

The container now says what it dies of, which it did not before:

    {"event":"sidecar.startup_failed","service":"google-execution-admission",
     "name":"Error","message":"Google admission Redis denied: url_not_tls"}

Two contracts written on this branch disagree.

- `.railway/railway.ts` gives the sidecar `PROVIDER_EPHEMERAL_REDIS_URL` and a
  CA: the provider-ephemeral Redis, dedicated, TLS, ACL user. `index.ts`
  enforces that contract whenever `NODE_ENV === 'production'`, and
  `Dockerfile.google-execution-admission` sets exactly that.
- `compose.local.yml` hands it `redis://redis:6379` — the shared cache, in
  plaintext, with no user — over a dedicated `google-admission-redis` network.

Moving the service onto the existing `provider-ephemeral` network was tried and
**reverted**: `assertGoogleIsolationTopology` in `scripts/local-stack/stack.ts`
pins this service's networks exactly, and the TLS session to the shared ingress
closed on connect besides. The isolation pin is right — the admission should
not share the provider's Redis.

The fix that satisfies both contracts is a DEDICATED TLS Redis for the
admission on the network it already has, mirroring the `provider-redis` /
`provider-redis-ingress` pair that already exists:

1. a `redis-server` with its own `aclfile` and `tls-cert-file`, on a new
   `google-admission-redis-data` network;
2. a `tcp-relay` in front of it on `google-admission-redis`, so the admission's
   pinned network list does not change;
3. an ACL user, a keypair and a `dnsName` for the relay generated alongside the
   provider pair in `stack.ts`;
4. the admission's `REDIS_URL` set to that `rediss://` URL, and the CA reaching
   the process — which needs a `PROVIDER_REDIS_TLS_CA_PATH` beside the existing
   `_PEM`, because a compose env file cannot carry a multi-line PEM. The mTLS
   material in the same module already has that `_PATH`/`_B64` duality;
5. `assertGoogleIsolationTopology` extended with the two new services.

Not attempted here: it is cert and ACL generation that cannot be verified
without running the stack, and iterating on it blind through CI would leave the
repository half-wired between attempts.

## Still blocked, and why

- **`ARC-03` cannot reach complete.** Five tasks need `eslint.config.js`, which a
  local `config-protection` hook blocks. The agent that hit it wrote the failing
  controls first, confirmed they went red for the right reason, then reverted
  cleanly rather than routing around a user-installed guard.
- **No package can pass repository verification** until one immutable candidate
  is frozen and the matrix reruns against that exact SHA.
- **34 packages need external evidence** that cannot be produced here. See
  [`external-verification-execution-pack.md`](../../operations/external-verification-execution-pack.md)
  for the eight lanes, the authority each needs, and what is already prepared.

## Recommended next checkpoint

1. Unblock and land the five `ARC-03` boundary tasks.
2. Schedule the five open review findings, starting with the backup-erasure
   ledger's own survival across a restore.
3. Ratify the canary observation window in ADR 0059.
4. Freeze one immutable candidate, rerun the whole matrix against that SHA, and
   only then move repository verification to `passed`.
5. Execute the external lanes in the order the pack gives, retaining each
   artifact as it is produced.

Nothing above should be read as beta readiness. A large amount of correct local
implementation is not a deployed, externally verified system, and the ledger is
built to keep saying so.
