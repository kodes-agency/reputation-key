# ADR 0047 — Persisted policy state

**Status:** Accepted
**Date:** 2026-07-17

## Context

ADR 0032 deferred per-tenant policy tables ("env vars suffice for internal beta"). Phase BQC-2 §2.2 requires authoritative persistence for organization cohort, enabled non-core capabilities, property allowlist and suspension, `PropertyAccessGrant`, policy/consent records, policy version, and content-free decision audit — with explicit constraints and a measured revocation bound. The existing `CapabilityPolicyStore` port (`beta-capabilities.ts`) is synchronous and env-backed; the web process initializes it lazily and the worker initializes it from env at boot.

Tenant consistency has never been enforced at the database level anywhere in the schema (deliberate "logical join" pattern, `dac.schema.ts`); phase §2.2 explicitly requires constraints for the new policy tables.

## Decision

**Schema (migration 0014).** New app-owned tables in `policy.schema.ts`: `organization_policy` (cohort + suspension), `organization_capability`, `property_policy`, `property_capability`, `property_access_grant` (scope/source/lifecycle), `policy_consent` (generic governed consent; AI opt-in later — phase §9), `policy_decision_audit` (identifiers/enums only, no tenant FKs — audit evidence survives tenant deletion per BQC-1.7), and `policy_version` (global counter). `property_access_grant` carries the schema's first composite foreign key — `(organization_id, property_id) → properties(organization_id, id)` via a new `properties_org_id_key` unique index — making cross-tenant grants unrepresentable. Uniqueness uses partial indexes: one active grant per (org, property, user), one active consent per (org, subject, purpose).

**Version-gated snapshot store.** `createPersistedPolicyStore` (`shared/auth/persisted-policy-store.ts`) serves the synchronous `CapabilityPolicyStore` port from an in-memory snapshot. Every policy mutation bumps `policy_version` in the same SQL statement (data-modifying CTE), so a committed mutation is never visible without its version bump. Refresh compares versions and reloads only on change; the stale window is bounded by `POLICY_REFRESH_INTERVAL_MS` (5s). A store that never refreshed and has no env seed fails closed (everything suspended, nothing allowlisted).

**Composite installation.** `initPersistedCapabilityPolicyStore` (identity infrastructure, called from `createContainer`) installs a composite: global posture (core sets, kill switch, e2e overrides) stays with the env store — BQC-0.3/0.4 semantics unchanged — while tenant state (allowlist, suspension) comes from the persisted snapshot. The `BETA_ALLOWLIST_ORGS` / `BETA_SUSPENDED_ORGS` env vars seed the snapshot and union in permanently, so env remains the operator emergency lever and installing the composite changes nothing until DB rows exist. The worker awaits one refresh before starting; `container.refreshPolicyStore()` is the strong-read handle protected side effects will use (BQC-2.5).

**Grant model.** Access to a property exists only as a `property_access_grant` row with `source` (`operator` | `migration` | `invitation`), optional expiry, and revoke metadata. BQC-2.3 reconciles legacy staff assignments into proposed grants (review required, not blind conversion); BQC-2.4 makes the grant the decision input. Nothing in this ADR grants access by itself.

## Consequences

- `BETA_ALLOWLIST_ORGS` / `BETA_SUSPENDED_ORGS` keep working (union seed); new allowlists/suspensions are DB rows managed by operator workflows (BQC-2.7).
- The drizzle meta chain remains broken (STD-P2-02): migration 0014 is hand-written + journal entry, no snapshot.
- Supersedes ADR 0032's "per-tenant database table deferred" note.
- Decision audit writes begin with the ExecutionPolicy (BQC-2.3+); the table and writer land now so the engine has no schema work left.
