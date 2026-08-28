# Fallow finding classification — 2026-08-28

## Scope and method

This is a current-tree classification, not a suppression list and not release
evidence. The tree contains the comprehensive-program implementation in
progress, so findings owned by an unfinished implementation are called out as
in flight rather than misrepresented as accepted production debt.

The analysis used Fallow 3.17.0 with the repository configuration, production
mode disabled, cache disabled, and no changed-file filter. Each safe edit was
checked against repository-wide references before it was made. No regression
baseline, boundary rule, severity, or ignore list was relaxed.

## Measured movement in this wave

| Category             | Before | Current | Net |
| -------------------- | -----: | ------: | --: |
| Total findings       |    377 |     331 | -46 |
| Unused files         |      1 |       1 |   0 |
| Unused exports       |    309 |     279 | -30 |
| Unused class members |     18 |       8 | -10 |
| Duplicate exports    |     14 |       8 |  -6 |
| Boundary violations  |     35 |      35 |   0 |

The safe fixes removed redundant public modifiers, replaced two value arrays
used only to construct types with direct unions, removed an unreachable Inbox
status-action module and an obsolete auth error component, removed an unused
Dashboard read, and disambiguated five duplicated contract/type names. These
changes also converged the egress gateway on its canonical admission-client
contract. They were API-surface cleanups; no runtime behavior or capability
policy was changed.

The current column is a later point-in-time rerun after additional context-owned
work. It includes separately verified lifecycle wiring, public-surface cleanup,
and reachability-proved CNV slices; it does not represent one atomic commit.

## Residual classification

### One unused file: analyser-scope blind spot

`src/shared/db/testing/test-organization-cleanup.ts` is imported by
`src/shared/testing/integration-helpers.ts`. The latter lives below the testing
tree excluded by the Fallow entry-point configuration, so that import edge is
not present in Fallow's graph even though integration tests use the helper.

Disposition: **verified analyser-scope blind spot**. Do not delete or suppress
the cleanup helper. Model the testing support tree as an explicit analysis zone
when the Fallow configuration is next refined.

### Organization response policies: distinct and now reachable

`src/contexts/identity/server/organizations.response-sla.ts` and
`ResponseSlaCard` are now reached from Organization Settings alongside the
Inbox Response Target controls. The older response-SLA value remains the input
to Property and Fleet dashboard attention calculations; the Inbox policies
govern private-feedback and Google-review response deadlines. An architecture
test pins both settings and both dashboard consumers so one cannot silently
replace the other.

Disposition: **resolved as two deliberately separate policies**. The module no
longer appears in the unused-file report.

### 279 unused-export diagnostics: mixed public surface and real API debt

The diagnostics divide into four non-overlapping shapes:

| Shape                        | Count | Classification                                                                                                                                  |
| ---------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Re-exports/barrels           |    63 | Mostly architectural public facades, but stale barrel members remain possible. Verify against an explicit public-API allowlist.                 |
| Direct server-module exports |    18 | Mostly framework entry-boundary shape, plus a small number of server helpers. Trace helpers before removal.                                     |
| Uppercase contract constants |   121 | Mixed evidence/test contracts and over-public internal constants. Trace each symbol; keep only documented external/governance contracts public. |
| Other direct helpers/schemas |    77 | Highest-value real-debt queue. Remove the export or the implementation after a symbol trace and focused test, in small context-owned slices.    |

Disposition: **not safe to label all 279 intentional**. The 63 facade rows and
18 framework rows explain a large static-analysis blind spot, while the 198
direct exports contain real API-hygiene debt. Process them context by context;
do not add a broad `ignoreExports` rule.

### Eight unused class members: structural dispatch and error contracts

- Three are Organization export-storage methods invoked through the structural
  storage port (`putEncrypted`, `readEncrypted`, and `delete`). Fallow does not
  resolve those calls to the concrete S3 class.
- Five are tagged error discriminator/code fields used as cross-boundary error
  contracts. These are intentional structural API, even where Fallow cannot see
  a property read.

Disposition: **three verified analyser blind spots and five intentional contract
fields**. The previously test-only Organization lifecycle/export commands now
have executable production boundaries and no longer appear in this queue.

### Eight duplicate-export diagnostics

| Symbol                                  | Classification                                                                | Follow-up                                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `BulkAssignInboxItemsInput`             | DTO input and branded application input share a misleading name               | Rename the DTO projection to make validation-boundary versus use-case authority explicit. |
| `ConnectGoogleAccountInput`             | Intentional use-case barrel re-export                                         | Keep only while the use-case index is an approved public facade.                          |
| `DisconnectGoogleAccountInput`          | Intentional use-case barrel re-export                                         | Same as above.                                                                            |
| `GOOGLE_PROVIDER_ROUTE_CATALOG_VERSION` | Intentional application public-API re-export                                  | Keep as a documented facade member.                                                       |
| `PortalMetricEvidence`                  | Source-port evidence and Dashboard presentation evidence are different shapes | Rename one or both to encode the boundary; do not merge the structures.                   |
| `correctFeedbackHandlingOutcome`        | Domain transition and application orchestration intentionally share a verb    | Optional clarity rename; not duplicate implementation.                                    |
| `isActive`                              | Two aggregate-local predicates                                                | Intentional context-local naming.                                                         |
| `validateSlug`                          | Shared generic validator plus context error adapters                          | Intentional layered adapters.                                                             |

Disposition: **three intentional facade rows, two genuine naming/contract
cleanup items, and three harmless context-local name collisions**.

### 35 boundary violations: test topology only

Every current boundary finding originates in a test file; there are zero
production boundary violations in the Fallow report.

- 28 are from two cross-context architecture integration fixtures under
  `src/shared/architecture`.
- 7 are focused shared-layer tests that deliberately instantiate a context
  port, domain event, or infrastructure adapter.

Disposition: **intentional test topology, not permission for production
cross-imports**. If a zero-noise report is required, model an explicit
architecture-test zone or relocate the fixtures to a dedicated unzoned test
root. Do not broaden the production `shared` boundary rule and do not ignore all
tests.

## Important zeroes

The same run reports zero unresolved imports, unlisted dependencies, circular
dependencies, re-export cycles, stale suppressions, policy violations,
production boundary violations, and dependency-override/catalogue defects.

## Recommended next slices

1. Rename the two ambiguous DTO/evidence types.
2. Audit the 77 direct helper/schema exports context by context with Fallow
   symbol traces and focused tests.
3. Create a reviewed public-API allowlist for application facades before
   suppressing any of the 63 re-export findings.
4. Represent architecture fixtures and shared integration support as explicit
   test zones so production boundaries remain strict and the report becomes
   signal rather than noise.
