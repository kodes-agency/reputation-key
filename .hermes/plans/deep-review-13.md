# Deep Review r13 — Error Handling & Result Types

## Findings

### F1. BLOCKER: Bare `catch {}` in application use cases — no logging
**Files:**
- `src/contexts/guest/application/use-cases/record-scan.ts:49`
- `src/contexts/guest/application/use-cases/track-review-link-click.ts:31`

Both have `catch {}` with only a comment ("Silent failure per I10"). Per rubric: "Every catch documents and either rethrows, maps to a typed error, or is recovery with a logged decision." Silent failures without logging make debugging impossible.

**Fix:** Add `getLogger().warn(...)` with error detail before the silent return.

**Triage:** relevant

### F2. BLOCKER: Identity auth-settings maps ALL errors to domain errors (400/409)
**File:** `src/contexts/identity/server/auth-settings.ts`

All four handlers (`changePassword`, `updateProfile`, `updateUserImage`, `createOrganization`) use bare `catch {}` → `throwContextError(...)` with fixed status. Infrastructure errors (DB, network) get mapped to 400/409 instead of 500. The original error is swallowed — no diagnostic info reaches logs.

**Fix:** Bind the error variable, log it, then call `throwContextError` for domain cases. For untagged errors, `throw e` and let `tracedHandler`'s outer catch handle via `catchUntagged`.

**Triage:** relevant

### F3. MAJOR: `MetricError` missing `context?` field
**File:** `src/contexts/metric/domain/errors.ts`

All other error types and the canonical `TaggedError` include `context?: Readonly<Record<string, unknown>>`. MetricError omits it, making it structurally incompatible with `TaggedError`.

**Fix:** Add `context?` field to `MetricError` type and smart constructor.

**Triage:** relevant

### F4. MAJOR: `IntegrationError` uses `recoverable: boolean` instead of `context?`
**File:** `src/contexts/integration/domain/errors.ts`

IntegrationError has a unique `recoverable: boolean` field but no `context?`. This breaks the `TaggedError` contract and is the only error type with this shape.

**Fix:** Add `context?` field alongside `recoverable`. Both can coexist.

**Triage:** relevant

### F5. MAJOR: `createErrorFactory` only used by 2/10 contexts
**Files:** `src/contexts/review/domain/errors.ts`, `src/contexts/inbox/domain/errors.ts`

Only ReviewError and InboxError use `createErrorFactory` from `src/shared/domain/errors.ts`. The other 8 contexts define inline smart constructors.

**Triage:** wontfix — Inline constructors are functionally identical and equally type-safe. Migrating 8 contexts for cosmetic consistency isn't worth the churn.

### F6. MAJOR: No common `DomainError` base class
**Rubric:** "Domain error classes that don't extend a common DomainError base — breaks instanceof discrimination."

**Triage:** outdated-doc — The codebase intentionally uses structural tagged objects (`_tag` field) with type guards (`isXxxError()`), not class instances. The `errors.ts` doc says "tagged error shape" explicitly. The rubric assumes class-based errors, which doesn't apply here.

### F7. BLOCKER-adjacent: Infrastructure `throw new Error()` in repositories
**Files:** ~10 repo files throw plain `Error` for insert/upsert failures.

**Triage:** wontfix — These are infrastructure-layer assertions for "should never happen" cases (insert returning no row). They bubble up to `tracedHandler` which wraps them as 500 via `catchUntagged`. The rubric's BLOCKER targets domain/application layers.

## Error Catalogue

### Domain Layer (tagged objects, return via `Result<T, XxxError>`)
| Context | Type | Codes | Has context? | Uses factory? |
|---------|------|-------|-------------|---------------|
| Review | `ReviewError` | 12 codes | ✓ | ✓ |
| Inbox | `InboxError` | 7 codes | ✓ | ✓ |
| Identity | `IdentityError` | 9 codes | ✓ | ✗ |
| Guest | `GuestError` | 8 codes | ✓ | ✗ |
| Portal | `PortalError` | 7 codes | ✓ | ✗ |
| Property | `PropertyError` | 5 codes | ✓ | ✗ |
| Integration | `IntegrationError` | 12 codes | ✗ (has `recoverable`) | ✗ |
| Metric | `MetricError` | 1 code | ✗ | ✗ |
| Team | `TeamError` | 5 codes | ✓ | ✗ |
| Staff | `StaffError` | 6 codes | ✓ | ✗ |
| Dashboard | (none) | — | — | — |

### Application Layer
- No `throw` in domain functions (all return `Result`)
- Application use cases throw tagged errors at boundary
- 2 bare `catch {}` without logging (guest analytics use cases)
- `list-gbp-locations` uses `catch {}` to retry then re-throw original

### Infrastructure Layer
- Repositories throw plain `Error` for impossible-state assertions
- Adapters throw tagged `IntegrationError` for external API failures
- `token-encryption.adapter.ts` throws plain `Error` for config/validation issues

### Server Boundary
- All server functions wrapped in `tracedHandler` (outer catch → `catchUntagged`)
- Domain errors caught with `isXxxError()` → `throwContextError(tag, error, statusCode)`
- Untagged errors re-thrown → caught by `tracedHandler` → `catchUntagged` (500)
- **Exception:** identity/auth-settings maps everything to domain errors
- **Exception:** dashboard uses `catchUntagged` directly (no domain errors)

### Layers with untyped throws
- Infrastructure (repos, adapters): plain `Error` — acceptable
- Application: none
- Domain: none
