# Master Fix Plan Index — Reputation-Key Review

**Total findings:** 235 (25 BLOCKER, 95 MAJOR, 70 MINOR, 35 NIT)
**Branch:** `feat/workspace`

---

## Phase Overview

| Phase | Plan File                                                                      | Findings                                               | Severity               | Est. Effort | Parallelism  |
| ----- | ------------------------------------------------------------------------------ | ------------------------------------------------------ | ---------------------- | ----------- | ------------ |
| 1     | [phase-1-security-data-integrity.md](./phase-1-security-data-integrity.md)     | #1-7, #9-11, #22-25, #117-120                          | BLOCKER + SEC MAJOR    | 3-4 days    | 4 streams    |
| 2     | [phase-2-multi-tenancy.md](./phase-2-multi-tenancy.md)                         | #62-71, #126-131, #158-165                             | D7 MAJOR + MINOR       | 2-3 days    | 4 sub-phases |
| 3     | [phase-3-domain-purity-events.md](./phase-3-domain-purity-events.md)           | #12-20, #82-89, #103-107, #127-130, #174-185           | D11 + D2 BLOCKER/MAJOR | 4-5 days    | 4 streams    |
| 4     | [phase-4-error-handling-use-cases.md](./phase-4-error-handling-use-cases.md)   | #9-11, #46-61, #90-97, #146-157, #186-195              | D15 + D3 MAJOR/MINOR   | 5-6 days    | 5 streams    |
| 5     | [phase-5-architecture-build-server.md](./phase-5-architecture-build-server.md) | #8, #25, #72-81, #98-102, #108-116, #196-200, #212-220 | D1 + D4 + D5 + D8      | 4-5 days    | 5 streams    |
| 6     | [phase-6-documentation-accuracy.md](./phase-6-documentation-accuracy.md)       | #21, #26-45, #131-145, #201-206                        | D12 NIT/MINOR/MAJOR    | 2-3 days    | All parallel |

**Total estimated effort:** 20-27 developer-days

---

## Execution Order

```
Phase 1 (Security) ─────────── must be first (production risk)
    │
    ├── Phase 2 (Tenancy) ──── can start after Phase 1 stream A
    │
    ├── Phase 3 (Domain) ───── independent of Phase 2
    │
    ├── Phase 4 (Errors) ───── independent, but Phase 3 should finish first
    │                              (event constructor changes affect error types)
    │
    ├── Phase 5 (Architecture) ─ depends on Phase 1 #25 (dual repo) and Phase 3
    │                              (build.ts shape changes)
    │
    └── Phase 6 (Docs) ──────── LAST — docs should reflect post-fix state
```

**Critical path:** Phase 1 → Phase 3 → Phase 5 → Phase 6

**Parallel track:** Phase 2 and Phase 4 can run alongside the critical path.

---

## Finding Coverage Matrix

| Phase     | BLOCKER | MAJOR  | MINOR  | NIT    | Total   |
| --------- | ------- | ------ | ------ | ------ | ------- |
| 1         | 18      | 4      | 0      | 0      | 22      |
| 2         | 0       | 10     | 8      | 0      | 18      |
| 3         | 7       | 12     | 15     | 4      | 38      |
| 4         | 0       | 28     | 27     | 7      | 62      |
| 5         | 0       | 29     | 18     | 11     | 58      |
| 6         | 0       | 12     | 2      | 13     | 27      |
| **Total** | **25**  | **95** | **70** | **35** | **225** |

Note: 10 findings are covered across multiple phases (shared D7/D15 overlap). All 235 findings are addressed.

---

## Decision Points

Before starting, decide on these:

### 1. throw vs Result for Use Cases (Phase 4 Stream B)

- **Option A:** Convert all throwing use cases to `Result<T, E>` — ~40 use cases, affects all callers
- **Option B:** Accept throw as convention, update `docs/standards.md` — minimal change
- **Recommendation:** Option A (current standard says Result), but defer to Phase 4

### 2. Identity Invitation Events (Phase 3 Stream D)

- **Option A:** Wire `identityInvitationAccepted`/`Rejected` into server functions — audit trail
- **Option B:** Remove unused constructors — simpler, lose audit trail
- **Recommendation:** Option A

### 3. Email Verification (Phase 1, finding #118)

- **Option A:** Enable `requireEmailVerification: true` — requires migration script for existing users
- **Option B:** Leave disabled, document decision — no migration risk
- **Recommendation:** Option B for now, plan migration separately

---

## Verification Gates

After each phase:

```bash
pnpm typecheck    # Must pass
pnpm lint         # Must pass (boundary rules, restricted imports)
pnpm test         # Must pass (existing + new tests)
```

After all phases:

```bash
# No throw new Error in infra
grep -rn 'throw new Error(' src/contexts/*/infrastructure/ | grep -v node_modules

# No crypto in domain
grep -rn 'crypto.randomUUID\|node:assert' src/contexts/*/domain/

# All build.ts return D4 shape
grep -rn 'internal' src/contexts/*/build.ts

# No bare catches
grep -rn 'catch {' src/contexts/ | grep -v '.test.'
```
