# Round 2 Fix Plan — 82 findings → 0

## Streams

### Stream R: BLOCKER — Arch Violation (1)

- **R1:** staff-goals.ts imports domain types directly (not through public-api)

### Stream S: MAJOR — hasRole → can() Migration (10 findings)

- **S1:** 7 inbox use cases: hasRole(ADMIN_ROLE) → can(inbox.read/write/manage)
- **S2:** list-google-connections: hasRole → can(integration.manage)
- **S3:** create-staff-assignment: hasRole → can(staff_assignment.create)

### Stream T: MAJOR — Throw → Result (2 findings)

- **T1:** create-goal.ts:201,270: throw new Error → err(goalError())

### Stream U: MAJOR — CONTEXT.md Lies (1 finding)

- **U1:** Portal CONTEXT.md documents wrong file structure

### Stream V: MAJOR — Permission-denied tests for can() use cases (22 findings)

- **V1:** Write permission-denied test for each of ~22 use cases that use can()

### Stream W: MINOR — Missing Permissions sections in CONTEXT.md (7 findings)

- **W1:** Add Permissions section to 6 contexts' CONTEXT.md

### Stream X: MINOR — Orphan permissions + doc gaps (10 findings)

- **X1:** Remove or document orphan permissions (ac.\*)
- **X2:** Extract OAuth scope magic strings to constants
- **X3:** Document domain rules hasRole as intentional

### Stream Y: NIT — Style cleanup (13 findings)

- **Y1:** API naming, documentation style
