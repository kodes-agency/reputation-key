# Frozen comprehensive-review baseline — `718fad18`

This directory is the immutable pre-implementation evidence root for the comprehensive beta implementation program.

## Source identity

- Frozen SHA: `718fad1807b7422885584660bd3580f2a3a49113`
- Contents: the merged Inbox implementation plus the approved comprehensive implementation program, before remediation code
- Source checkout: detached and clean
- Runtime: Node `22.23.2`, pnpm `10.6.5`, Darwin arm64
- Drizzle head: `0078_ai-language-catalogue-repin` (79 journal entries)

The environment-specific evidence is in `local-darwin-arm64-node22.23.2/`. Its manifest binds the lockfile, generated route tree, implementation plan, consolidated report, and inventory-tool digests.

## Inventory

- 3,260 tracked artifacts
- 2,649 TypeScript/JavaScript source files
- 6,483 function-like symbols
- 13,417 import edges
- 213 independently detected route/server/consumer/job/operator/sidecar entry points
- 114 consolidated findings, all mapped to at least one implementation package

The generated finding register carries the earlier evidence classification and explicitly marks every row as requiring frozen-SHA revalidation. It is an assignment and traceability input, not proof that a finding is still present or closed.

## Baseline gates

The frozen-lockfile install succeeded. Of 18 configured baseline gates:

- 12 passed: format, types, lint, unit, web build, worker build, AI egress build, Storybook build, dependency audit, and the three Fallow checks;
- 1 failed: Storybook interaction tests (3 failures across notification overflow and two Property reputation-trend stories);
- 5 were honestly skipped because this local evidence environment had no dedicated database or E2E credentials: migrations, integration, E2E seed, critical E2E, and full E2E.

The two unit failures named by the earlier report no longer reproduce at this SHA. `GATE-01` remains open because the Storybook gate fails and database/browser release evidence is incomplete.

## GitHub governance snapshot

The captured GitHub state shows classic `main` branch protection with required `check`, `docker`, `e2e`, `secrets`, and `audit` contexts, linear history, and force-push/deletion denial. It also shows no repository rulesets, non-strict status-check synchronization, no admin enforcement, no required signatures, and no required conversation-resolution rule. This supersedes the earlier blanket statement that branch protection was absent while retaining the narrower governance gaps for later treatment.

Do not edit generated files in this directory. Later verification belongs in a new evidence record that references this frozen baseline.
