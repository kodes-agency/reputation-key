# Consecutive Clean Review Plan

**Date:** 2026-06-11
**Goal:** Run a comprehensive review, fix actionable findings, then require 3 independent consecutive review passes with zero actionable issues.

## Review posture

Senior reviewer stance: strict about correctness, tenant isolation, architecture boundaries, documented conventions, and boring maintainable code. No decorative abstractions. No "probably fine" claims.

## Rubric

1. **Correctness / tenant isolation**
   - No cross-tenant reads or writes.
   - Authorization gates exist before tenant-sensitive data access.
   - State transitions enforce invariants.
   - Race-prone writes have guards or documented constraints.

2. **Architecture boundaries**
   - Domain: pure, no I/O, no framework imports.
   - Application: no DB/HTTP/React/framework imports.
   - Infrastructure: no business routing.
   - Server: no direct DB/business logic.
   - Cross-context imports only through `application/public-api.ts`.

3. **Existing pattern adherence**
   - Use cases follow authorize → load → rule → domain → persist → emit → return.
   - Build functions expose `publicApi` and `internal`.
   - Repositories use branded IDs and tenant-scoped parameters.
   - Events follow `_tag`, type naming, constructor, envelope, and union rules in `docs/standards.md`.

4. **Documentation accuracy**
   - `CONTEXT.md` files match current files, use cases, events, permissions, and public API.
   - ADRs reflect actual architectural decisions.

5. **Test quality**
   - Tests assert behavior, not plumbing.
   - Tenant isolation and denial cases are covered.
   - Edge/race cases are covered where code has meaningful risk.

6. **Security / UX surface**
   - Public inputs are validated.
   - Sensitive endpoints are permission-checked and rate-limit aware where applicable.
   - UI controls are accessible and keyboard usable.

## Execution loop

1. **Pass N review**
   - Run independent reviewers across the rubric.
   - Synthesize findings into `docs/reviews/consecutive-clean-review-N.md`.
   - Deduplicate and classify as actionable code/doc/test fix vs product/architecture decision.

2. **Fix**
   - Fix actionable findings only.
   - Do not add speculative features or architecture.
   - Update docs/tests when code changes.

3. **Verify**
   - Run targeted tests for changed code.
   - Run workspace checks that are practical for the touched surface.

4. **Repeat**
   - Repeat with fresh reviewers or fresh pass assignments.
   - Exit only when 3 consecutive passes report zero actionable issues.

## Exit criteria

- Three independent review pass reports exist.
- Each pass has zero actionable findings.
- Verification commands pass or any failure is unrelated and explicitly identified.
