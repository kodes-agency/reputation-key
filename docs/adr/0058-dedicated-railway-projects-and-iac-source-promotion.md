---
status: accepted
date: 2026-08-27
---

# 0058 — Dedicated Railway projects and IaC-owned source promotion

## Context

ADR 0057 reduced beta to one logical Data Cell, but its initially accepted
release mapping still named the legacy `reputation-key` Railway project as the
production target and described image attachment as a release-controller
concern outside the declarative project graph. Live-state inspection showed
that project already contains service
instances in Amsterdam-backed `production`, `staging`, and
`google-closed-beta` environments.

Railway service source association is project-service scoped rather than an
environment-local release primitive. Reusing those project services for the US
cutover could therefore change source ownership outside `cell-us`. Conversely,
leaving sources out of `.railway/railway.ts` would make a later declarative plan
see the controller-attached source as drift and try to remove it. A safe release
needs one owner for desired source state and a reviewed plan that cannot be
silently recomputed between approval and apply.

Railway CLI 5.45.2 provides the saved-plan interface used by this decision:
`config plan --out` and `config apply --plan`.

A matching IaC digest alone is insufficient. IaC identifies the desired
Railway graph, but locally executing release code chooses the target, validates
evidence, invokes Cosign, opens the operator audit path, and applies that graph.
That authority must be signed too.

## Decision

1. The production target is a fresh, dedicated Railway project named exactly
   `reputation-key-us-beta`. The rehearsal target is a separately permissioned
   project named exactly `reputation-key-us-beta-rehearsal`. The legacy
   `reputation-key` project is migration input and a bounded rollback source;
   it is not a promotion target.
2. Each target project has exactly one Railway environment total, named
   `cell-us`. Rename the fresh project's default environment; do not create a
   second environment beside it. Before both the source-less foundation plan
   and its later apply, the repository controller reads the full project
   inventory and proves the exact reviewed project plus exactly one accessible
   `cell-us` environment with zero services, service instances, buckets,
   volume instances, or unmerged changes. This full-project proof rejects the
   environment-scoped `RAILWAY_TOKEN`; it requires a logged-in user or
   account/workspace-scoped `RAILWAY_API_TOKEN`. Before
   any later release mutation, the controller repeats the target proof and
   enforces the same full-project credential requirement. It
   additionally requires all eight source-managed services exactly once, with
   one service instance each in `cell-us`. Because
   an ID-pinned Railway IaC evaluation may omit its human-readable project name,
   the reviewed exact `REPKEY_RAILWAY_PROJECT_NAME` must accompany the opaque IDs:
   `reputation-key-us-beta` for `production` and
   `reputation-key-us-beta-rehearsal` for `rehearsal`. IaC rejects disagreement
   with any name present in Railway's evaluation context. The project name,
   profile, environment name, and reviewed opaque project, environment,
   service, and service-instance IDs must all agree.
3. `.railway/railway.ts` is the sole owner of every managed service source. Its
   source input is an explicit canonical JSON document. The one-time
   `foundation` document contains no sources and is valid only while creating a
   fresh isolated project. Foundation uses the source-controlled controller,
   retains a private saved plan, proves the exact frozen 16-create graph and
   Railway change-set hash, independently verifies Railway's saved `.railway`
   source-tree identity, prints its byte SHA-256 for named review, and applies only
   that unchanged, non-destructive, exact-environment artifact after a second
   live isolation preflight. It verifies every apply operation, the complete
   source-less services/databases/volumes/bucket readback, and a fresh
   source-less IaC no-drift plan against the frozen graph before success. If
   apply returned ambiguously, a non-mutating verify mode reproduces those
   final proofs without repeating the create. A `promotion`
   document contains only
   approved registry references pinned by lowercase `sha256` digest and grows
   in the canonical deployment order.
4. Railway CLI 5.45.2 refuses to register a custom domain through IaC. The
   production foundation therefore creates `web` without
   `us.reputationkey.app`. Before the first source promotion, a separate
   repository controller writes a canonical exact-ID intent, applies only its
   reviewed SHA-256, creates and verifies Railway's service probe first, then
   registers that one custom hostname on port 8080 and verifies the exact
   two-domain readback. Every mode first proves the complete source-less
   foundation graph is no-drift. Exact-state recover and verify modes handle
   ambiguous results without repeating a create; final verification requires
   ACTIVE synchronization, DNS ownership, a valid certificate, and a read-only
   import proving the live `web` graph retains the hostname on port 8080. Promotion graphs
   then declare and retain the existing custom domain. This is a bounded
   platform exception for domain registration, not another graph or source
   owner; rehearsal cannot invoke it.
5. `railway service source connect`, dashboard source edits, mutable image
   tags, GitHub sources, local uploads, and any second source owner are
   prohibited for these projects. Every source change uses the versioned pinned-plan
   interface from Railway CLI 5.45.2 or newer (`railway config plan --out`),
   validates that the saved artifact targets the
   reviewed IDs and changes exactly the intended non-destructive source, then
   applies that same artifact with `railway config apply --plan`.
6. The one-time foundation/domain schemas are pinned to Railway CLI 5.45.2
   exactly; another version requires explicit contract review. Ordinary release
   promotion accepts Railway CLI 5.45.2 or newer. A release first retains the full
   candidate plan bound to the canonical promotion-manifest digest, matching
   IaC digest, exact target, raw plan hash, and plan outcome. The controller
   then advances one service source at a time, waits for the exact digest to
   reach terminal `SUCCESS`, and finishes with a full-candidate no-drift plan.
   A no-op is acceptable only when the source already equals the candidate; a
   bounded explicit redeploy may recover that exact already-owned source when
   no new deployment was created.
7. Promotion manifest v4 signs `contract.releaseControllerSha256` over the
   explicit release-authority source set: `.railway`, package/lock/toolchain
   inputs, all release scripts, the operator-command entry point, Identity,
   Property, and Team authority, and shared policy/runtime code. Railway plan evidence
   v5 copies
   it as `release.controllerSha256`; bootstrap authorization v2 records the
   same signed digest in its release record.
8. Planning, migration, and promotion recompute that source-set digest and
   require equality with both signed manifest and retained plan evidence before
   Cosign, Railway, or audit actions. The migration and serving controllers
   recheck after Cosign; serving promotion rechecks again immediately before
   dynamically importing the operator authority. Any covered local change
   requires a newly signed manifest and newly captured plan.
9. `release:migrate-cell` is mandatory for every signed candidate, not only
   the first migration that introduces `0140`. It advances
   `schema-migrator` first through the same saved-plan path and waits for the
   signed web image's migration process to succeed. The operator then
   recaptures the full candidate plan before serving promotion. Web's
   pre-deploy migration remains an idempotent check, never the first migration
   authority.
10. Production and rehearsal are deployment profiles of the same logical `us`
    Data Cell contract. They do not create a second beta cell, add a country
    partition, or authorize `europe`/`global` infrastructure. Repository state
    and rehearsal results are not evidence that production has been deployed.

## Supersession

This ADR supersedes ADR 0057's choice of the legacy `reputation-key` project as
the production target, its generic separately named rehearsal project, and its
source-attachment/no-drift release procedure. ADR 0057 remains authority for
the one-cell beta topology, California placement, exhaustive supported-country
mapping, denied dormant identifiers, resource isolation, and future-expansion
gates. ADR 0051 remains authority for release identity and canary ergonomics
where it does not conflict with the exact saved-plan contract above.

## Consequences

- The beta has one production Data Cell and one non-production rehearsal of the
  same graph, while production release actions cannot mutate legacy Amsterdam
  service instances.
- Source ownership is deterministic: a later IaC plan preserves the exact
  candidate instead of treating an out-of-band attachment as drift.
- Initial provisioning has a deliberate source-less foundation step whose
  normal apply and ambiguous-result recovery both end in exact-state no-drift
  proof. After
  any source exists, rerunning the foundation document is forbidden because it
  would request source removal.
- Production custom-domain registration is a deliberate, reviewed Railway
  platform exception between foundation and first promotion; subsequent IaC
  plans retain the exact hostname.
- Every candidate adds a migration and plan-recapture step, but the retained
  artifacts bind human review to the exact state that is applied.
- An IaC-only review cannot authorize release code changed after signing; the
  controller digest fails closed before it can use Cosign, Railway, or the
  operator audit path.
- The project names are policy, not proof of placement. Live region, bucket,
  domain, backup, provider, and deployment evidence remain required.

## Rejected alternatives

- **Reuse the legacy multi-environment project** — project-scoped source
  association makes the blast radius larger than the reviewed `cell-us`
  environment.
- **Attach sources with `service source connect`** — creates a second owner and
  makes the next declarative graph plan request removal or replacement.
- **Let apply compute a fresh plan** — permits remote drift between review and
  mutation; the saved reviewed artifact is the apply authority.
- **Deploy several beta cells to obtain isolation** — project isolation solves
  the release blast radius without changing ADR 0057's one-cell product model.
