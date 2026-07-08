# Remaining Work — rep-key

**Last updated:** 2026-07-06 (end of DAC Stage 2 session, branch `review/deep-review-sweep`)
**Test baseline:** 259/259 files · 2403 tests · tsc 0 · eslint + boundaries clean · §6 CI greps all 0

This doc tracks everything that is **not yet done** after the DAC Stage 2 + deep-review-sweep
work. Each item has a priority, why it matters, what blocks it, and how to verify completion.
Pick it up by priority; items within a priority tier are independent unless noted.

---

## P0 — Blocks correctness or production readiness

### 1. Production activation of `ENABLE_CUSTOM_ROLES`

**Status:** Code complete + verified locally. Flag is `true` in `.env` (gitignored). Production env not yet set.
**Why it matters:** DAC Stage 2 (custom/multi roles, per-permission scope) is inert until the flag is on in the deployment environment. With it off, non-built-in member roles are fail-closed rejected (403).
**Done prerequisites (all met):**

- input.role→ctx migration complete across all 5 contexts (activity, inbox, review, goal, portal) + list-properties + list-teams.
- §6 architectural invariants hold: `hasOrgWideScope`=0, `ctx.role === 'AccountAdmin'` in server/application=0, literal-boolean `getAccessiblePropertyIds`=0.
- Client DTO (`usePermissions().scopeForPermission`) shipped (commit `34a9884`).
- Full suite green with the flag **on** (Stage 2 active): 259/259 (2403).
  **Action:** Set `ENABLE_CUSTOM_ROLES=true` in the production/staging environment variables. Rollback = set it back to `false` (Stage 1 fail-closed).
  **Verify:** A member with a custom role resolves (no 403); a member with `portal.update@organization` sees org-wide portal updates; `scopeForPermission` returns the policy-defined scope.
  **Risk:** With the flag on, every auth resolution reads `organizationRole` + `organization_role_policy` (one DB query per request, currently uncached — see item 3).

### 2. Better Auth cannot bootstrap a fresh database

**Status:** Open ticket — full detail at [`docs/ba-fresh-db-provisioning.md`](./ba-fresh-db-provisioning.md).
**Why it matters:** `pnpm auth:migrate` silently does nothing on an empty DB (no baseline migration captured). New dev / CI / fresh staging & prod **cannot provision auth tables**. Currently masked because Neon already has the baseline.
**Action:** Capture the baseline auth schema (8 tables) as a migration or bootstrap SQL. Verify against a truly empty DB.
**Acceptance:** Empty Postgres + `pnpm auth:migrate` creates all 8 auth tables with correct camelCase columns; reproducible from a clean clone.
**Blocks:** Clean-slate provisioning for any new environment.

---

## P1 — Hardening / performance / should-do before scaling

### 3. Multi-instance stale-window + resolver caching

**Status:** Known residual gap. Single-instance is safe.
**Why it matters:** `resolveTenantContext` resolves permissions via a live DB read (uncached). `getAccessiblePropertyIds` is also uncached (live query). Permission revocation via the Postgres triggers (§4 of the DAC plan) bumps `permission_version` atomically, but with **>1 instance** there is a ≤5 s window where a revoked permission may still be honored on another instance that hasn't observed the version bump.
**Also:** every request currently does a `fetchRoleDefinitions` DB round-trip. The plan §5 specifies a `(organizationId, userId, permission_version)`-keyed cache that is NOT yet implemented.
**Action:**

1. Implement the version-keyed resolver cache (key on `(orgId, userId, permission_version)`; invalidate on version bump). This removes the per-request DB read.
2. Only then enable >1 instance.
   **Verify:** Revoke a permission on instance A → instance B honors the revocation within the version-bump propagation window (test with two running instances).
   **Dependency:** Needs the version-cache implementation (code) before multi-instance deploy.

### 4. GBP Pub/Sub notification lifecycle — live verification

**Status:** Code complete (commits `4fb98ef`, `dea201e`). Live end-to-end verification gated on infrastructure.
**Why it matters:** The subscribe-on-first-import / unsubscribe-on-disconnect lifecycle is implemented but has never run against a real Google Business Profile account + GCP Pub/Sub topic.
**Done (code):** global Google-account uniqueness (one account ⟂ one org); `MyBusinessNotificationsPort` + HTTP adapter (`updateNotificationSetting` PATCH); `manageNotifications` use case (best-effort, refreshes token, resolves GBP account id via `listAccounts`); subscribe on 0→1 property import (`countByGoogleConnectionId`); unsubscribe on disconnect; env vars `GBP_PUBSUB_TOPIC` (default `''` = disabled), `GBP_PUBSUB_NOTIFICATION_TYPES` (default `NEW_REVIEW`).
**Action (infra, not code):**

1. Create a GCP Pub/Sub topic + subscription.
2. Grant the publisher role to the GBP service account.
3. Set `GBP_PUBSUB_TOPIC` in the environment.
4. Import a property → verify `updateNotificationSetting` registers the webhook.
5. Trigger a real GBP review → verify `handleGbpNotification` receives + processes it.
6. Disconnect the Google account → verify unsubscription.
   **Verify:** End-to-end: review created in GBP → inbound notification → review synced. No manual review sync needed.
   **Note:** The inbound notification handler (`handleGbpNotification`) has a clarifying comment on its filter logic.

### 5. Re-verify BA trigger/index casing after any Better Auth upgrade

**Status:** Verified correct as of 2026-07-06 against the live Neon tables. Not automated.
**Why it matters:** The DAC triggers (`tgr_bump_perm_ba`, last-owner backstop) + the `organization_role_org_role_lower_unique` index + the app-owned accept/role services reference BA-owned tables by exact casing: `member("organizationId","role","userId")`, `organizationRole("organizationId","role")`, `invitation("role" NULLABLE, "propertyIds")`. A BA upgrade that renames columns silently breaks triggers/services.
**Action:** After any `better-auth` version bump, re-run `\d member`, `\d "organizationRole"`, `\d invitation` against the DB and confirm the casing. Add a CI assertion if feasible.
**Verify:** Casing matches; triggers fire on mutation; app-owned role/invitation writes succeed.

---

## P2 — Code debt / cleanup (no behavioral impact)

### 6. Repo-wide `eventId` IdGenerator

**Status:** ~11 `domain/events.ts` files call `crypto.randomUUID()` directly for `eventId`.
**Why it matters:** Inconsistent with the injected-`idGen` pattern used for entity IDs. Makes event IDs non-deterministic in tests (harder snapshot/assertion). Low urgency — events are append-only.
**Action:** Codemod: inject an `eventIdGen` (or reuse the context's `idGen`) into event factory functions across all contexts, replacing `crypto.randomUUID()`. Cross-context change.
**Verify:** `grep -rn 'crypto.randomUUID' src/contexts/*/domain/events.ts` → 0.

### 7. Materialized views are not Drizzle-managed

**Status:** 3 materialized views live only in `scripts/migrations/add-materialized-views-and-gbp-index.sql` (raw SQL). Several other raw-SQL migration files in `scripts/migrations/` are also outside Drizzle's purview.
**Why it matters:** These aren't tracked by `db:generate`/`db:migrate`, so a fresh DB won't have them unless the SQL is applied manually. Drift risk.
**Note:** Drizzle's matview support is limited; raw SQL may genuinely be necessary here. At minimum, document the apply order in the provisioning runbook (depends on item 2).
**Action:** Either (a) add Drizzle `pgMaterializedView` defs where supported, or (b) fold the raw-SQL files into a documented bootstrap step in the fresh-DB provisioning runbook.
**Verify:** Fresh DB has the matviews after provisioning; `db:migrate` doesn't drop them.

### 8. Goal completion-policy layering

**Status:** Deferred — needs the goal integration suite.
**Why it matters:** Goal completion semantics (when a goal is "done") may need layered policy (e.g., recurring vs one-shot, expiry). Currently minimal.
**Action:** Define + test the completion policy in the goal domain; add an integration suite.
**Dependency:** Goal integration test suite (does not yet exist as a dedicated suite).

### 9. `replies` partial-unique "must be raw SQL" comment

**Status:** Stale/inaccurate comment (per session notes).
**Why it matters:** A comment claims a partial unique index "must be raw SQL" — Drizzle can express partial uniques. Misleads future maintainers.
**Action:** Verify Drizzle can express it; if so, move it into the schema + remove the stale comment; if not, clarify _why_ raw SQL is necessary.
**Verify:** Comment accuracy; schema matches DB.

---

## P3 — Product / UX (needs a product decision)

### 10. NotificationBell popover behavior

**Status:** Known bug; needs product confirmation on intended UX.
**Action:** Get product input on the intended popover behavior (open-on-click vs hover, dismiss semantics, unread badge). Then fix.
**Dependency:** Product decision (not a code blocker).

---

## Architectural invariants to maintain (enforced)

These are now green and should stay green. They are the load-bearing guarantees of the DAC model:

| Invariant                                                             | Grep                                                                                                                       | Current  |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------- |
| No `hasOrgWideScope`                                                  | `grep -rn 'hasOrgWideScope' src`                                                                                           | **0** ✅ |
| No `ctx.role === 'AccountAdmin'` scope shortcut in server/application | `grep -rn "ctx\.role === 'AccountAdmin'" src/contexts/*/server src/contexts/*/application`                                 | **0** ✅ |
| No literal-boolean `getAccessiblePropertyIds` in server/application   | `grep -rnE 'getAccessiblePropertyIds\([^)]*,[[:space:]]*(true\|false)\b' src/contexts/*/server src/contexts/*/application` | **0** ✅ |
| `ENABLE_CUSTOM_ROLES` flag-hermetic middleware tests                  | —                                                                                                                          | ✅       |

**Rule:** server-side record visibility always derives scope from the exact governing permission via `scopeForPermission` / the permission wrappers — never a manual boolean, a raw role comparison, or a generic shortcut.

---

## Session commit map (this branch)

DAC Stage 2 + deep-review-sweep — 22 commits, newest first:

```
b3e1a2d test: make resolveTenantContext Stage 1 tests flag-hermetic (flag flip verified)
4a34ed6 refactor: list-properties + list-teams scope → per-permission
943ba27 refactor: portal scope → per-permission (22 callers, completes input.role→ctx)
8bf0efd refactor: goal context → ctx
2464e2d refactor: review context → ctx
8c790fb refactor: inbox context → ctx
bd202b6 refactor: activity queries → ctx
34a9884 feat: Client DTO (ClientAuthz + usePermissions scope) (§7)
7140247 feat: transactional acceptInvitation (§3)
a50e28c feat: last-owner app guard (§4)
421b1c2 feat: app-owned update/delete custom role services (§2)
ebbe090 feat: app-owned createCustomRole service (§2)
776b8c4 feat: dynamic resolver wired into resolveTenantContext
7f87153 refactor: action codemod can(ctx.role) -> canForContext (134 sites)
4855ddc feat: permission-specific property visibility (orgWide lookup)
7c4c69f feat: AuthContext scope map + context-aware helpers (foundation)
dea201e feat: GBP Pub/Sub notification lifecycle — steps 2-3/3
4fb98ef feat: global Google-account uniqueness — Pub/Sub step 1/3
90d807f fix: scope getNewCount correctly for PM/Staff
49a20c3 chore(lint): raise component max-lines 150->200
3f0161e/908d0c4 chore(db): migrate-based Drizzle workflow + resolve schema drift
685e989 feat: DAC Stage 1 — fail-closed safety patch
```

Full DAC architecture: [`docs/adr/0001-dynamic-access-control.md`](./adr/0001-dynamic-access-control.md) + the frozen plan at `local://dac-dynamic-authorization-plan.md`.
