# ADR 0006 — Staff as a Separate Bounded Context

**Status:** Implemented
**Date:** 2026-05-22
**Context:** Identity, Staff Management Architecture

## Decision

Extract Staff from the Identity bounded context into its own `staff` bounded context. Identity retains only authentication, session management, and organization membership. Staff owns staff profiles, assignments, properties, and all staff-related domain logic.

## Context

The Identity context grew beyond its original mandate. Originally responsible for authentication and authorization (Better-auth, dynamic access control, roles, permissions), it accumulated staff-specific domain logic: staff profiles, property assignments, staff listing, and staff CRUD operations. These responsibilities are conceptually distinct — authentication/authorization is infrastructure, while staff management is a core business domain.

The business needs:

1. Staff profiles have their own lifecycle (create, update, assign properties, deactivate) independent of auth concerns
2. Staff assignments to properties is a business rule, not an auth rule
3. The staff domain will grow (performance tracking, schedules, activity logs) — none of which belong in Identity
4. Identity should remain focused on auth/session/role concerns to avoid becoming a god context

## Alternatives Considered

### A. Keep staff in Identity

Staff CRUD and assignments remain inside Identity. One context owns users, auth, roles, and staff management.

- **Pros:** Fewer context boundaries. No new `build()` function. Simpler wiring.
- **Cons:** Identity becomes a god context — every new staff feature (schedules, performance, activity logs) lands in auth code. Mixed concerns make testing harder. Auth deploy risks breaking staff features and vice versa.

### B. Staff as a separate bounded context (chosen)

New `staff` context owns: staff profiles, property assignments, staff listing, staff CRUD, and future staff domain features. Identity retains: authentication, sessions, organization membership, roles, permissions.

- **Pros:** Each context has a clear, singular responsibility. Identity stays focused on auth/security. Staff domain grows independently. Clean dependency direction via facade ports.
- **Cons:** More wiring in `composition.ts`. Cross-context staff data access requires explicit ports. More files and folders.

### C. Merge staff into Property context

Staff assignments link staff to properties, so place staff logic in the Property context.

- **Pros:** Fewer contexts. Assignment logic co-located with property data.
- **Cons:** Staff is not a child entity of property — staff exist independently of properties. Property context would absorb a second domain. Assignment is a relationship, not ownership.

## Consequences

### Positive

- Identity context stays thin and focused on auth/security concerns
- Staff domain can grow (schedules, performance, activity logs) without touching auth code
- Clear ownership: staff profile changes don't require reviewing auth logic
- Facade port enforces clean dependency direction: staff queries identity via interface, never directly

### Negative

- More wiring in `composition.ts` (additional context to compose)
- Cross-context staff lookups require explicit ports — no direct DB queries from other contexts
- Staff profile creation still depends on Identity for user existence validation

### Risks

- If staff and identity concepts remain tightly coupled in the UI (e.g., user creation implies staff creation), the context boundary may feel like overhead — mitigated by clear port interfaces and composition-layer orchestration
- Dual writes during staff onboarding (create user in Identity, create profile in Staff) require careful transaction handling or eventual consistency
