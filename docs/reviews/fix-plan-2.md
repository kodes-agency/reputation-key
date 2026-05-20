# Fix Plan #2 — Based on Review #1 (Phase 10-11)

## Priority Order

### Critical (must fix)

1. **C1**: sync-reviews partial success → return ok() with partialFailure flag
2. **C2**: get-unread-count fallback → document org-level semantics, remove misleading per-user key (or fix)

### Major (should fix)

3. **M1**: Variable shadowing `catch (err)` → rename to `catch (e)`
4. **M2**: Hardcoded `new Date()` in repos → pass clock to repo factories
5. **M3**: Hardcoded non-existent platforms → remove from filter
6. **M5**: Document Phase 12 constraint issue (schema change needs migration)
7. **M6**: Hoist access check outside bulk loop
8. **M4**: N+1 batch fetch (add findByIds to repo port) — if time permits

### Minor (nice to have)

9. **m5**: Fix error context type wrapping
10. **m1**: Standardize branded ID handling

### Nits (skip unless time)

11-13: Documentation/comments only

## Execution Plan

### Batch 1: Critical + Quick Major

- Fix C1: Change sync-reviews return logic
- Fix M1: Rename catch variable
- Fix M3: Remove fake platforms from filters
- Fix m5: Wrap error context properly

### Batch 2: Major structural

- Fix C2: Clarify unread count semantics, fix the fallback
- Fix M6: Hoist access check in bulk update
- Fix M2: Clock injection in repositories

### Batch 3: Run tests, verify, iterate
