# Deep Review #4 — Application / Use Case Layer Fix Plan

## Scope
Fix BLOCKERs + quick MINOR fixes. MAJORs (implicit transactions, missing tests) documented as known debt.

## Tasks

### B1: Extract PG 23505 from import-property use case
- Define `DuplicateKeyError` on `PropertyImportRepo` port
- Move the PG error check to the Drizzle repo adapter
- Use case catches `DuplicateKeyError` instead

### B2: Extract PG 23505 from connect-google-account use case
- Define `UniqueViolationError` on `GoogleConnectionRepository` port
- Move the PG error check to the Drizzle repo adapter
- Use case catches `UniqueViolationError` instead

### m1: Rename createInboxItemUseCase → createInboxItem
- Rename function
- Update all callers

### m3: Fix recordMetric generic Error
- Use domain error constructor instead

### Known debt (not fixing now):
- 5 implicit transaction boundaries → add doc comments
- 11 missing test files → Phase 15
- reply-operations.ts split → wontfix
