# Identity Context Domain Architecture

## Intentional Deviation from Standard Patterns

This context intentionally **does not** have `types.ts` or `constructors.ts` files, unlike other contexts (property, guest, team, portal, staff). This is a deliberate architectural decision, not an oversight.

## Why Identity Context Is Different

### 1. Wrapper/Adapter Pattern

The identity context is a **wrapper around better-auth**, not a traditional domain-driven bounded context. Better-auth provides:

- User management (sign up, sign in, sessions)
- Organization management (create, update, list)
- Membership management (invite, accept, roles)
- Invitation workflow (create, accept, reject, expire)

These are fully-featured domain entities with their own:

- Database schema
- Business rules
- Validation logic
- Lifecycle management

### 2. Types Defined by better-auth

The core domain entities are defined by better-auth's database schema and API responses. The identity context does not own these types; it only **adapts** them.

**Where the types live:**

- **Port layer** (`application/ports/identity.port.ts`): Defines the adapter types
  - `MemberRecord` - wraps better-auth member data
  - `InvitationRecord` - wraps better-auth invitation data
  - `OrganizationRecord` - wraps better-auth organization data

- **Infrastructure layer** (`infrastructure/adapters/`): Maps better-auth responses to port types
  - `auth-identity.adapter.ts` - Implements `IdentityPort` using better-auth API
  - `better-auth-schemas.ts` - Zod schemas for better-auth responses

### 3. No Smart Constructors Needed

Smart constructors (`constructors.ts`) are used in other contexts to:

1. Build domain entities from raw input
2. Validate business rules
3. Compose validation results
4. Return `Result<entity, error>`

**This doesn't apply to identity because:**

| Operation           | Where It Happens                       | Returns             |
| ------------------- | -------------------------------------- | ------------------- |
| Sign up user        | `better-auth.api.signUpEmail()`        | User object with ID |
| Create organization | `better-auth.api.createOrganization()` | Organization ID     |
| Create invitation   | `better-auth.api.createInvitation()`   | Invitation ID       |
| Accept invitation   | `better-auth.api.acceptInvitation()`   | void                |

These are **I/O operations that directly persist to the database**, not pure functions that build in-memory entities. The identity context delegates these operations to better-auth rather than building entities itself.

### 4. What Identity Context Does Provide

The identity context provides the domain logic that **better-auth doesn't**:

#### Domain Rules (`rules.ts`)

- `validateSlug()` - URL-friendly slug format validation
- `validateOrganizationName()` - Name length/format validation
- `canInviteWithRole()` - Role hierarchy for invitations
- `canChangeRole()` - Role hierarchy for role changes
- `normalizeSlug()` - String transformation for slugs

These are **pure functions** that validate simple values, not complex entities.

#### Domain Events (`events.ts`)

- `OrganizationCreated` - Track when orgs are created
- `MemberInvited` - Track when invitations are sent
- `InvitationAccepted` - Track when invitations are accepted
- `InvitationRejected` - Track when invitations are rejected
- `MemberRemoved` - Track when members are removed
- `MemberRoleChanged` - Track when roles change

These events are emitted by use cases after delegating to better-auth, allowing other contexts to react to identity changes.

#### Domain Errors (`errors.ts`)

- Tagged error shape with `_tag`, `code`, `message`, `context`
- Error codes: `forbidden`, `invalid_slug`, `invalid_name`, `member_not_found`, `invitation_not_found`, `registration_failed`, `org_setup_failed`
- Type guard `isIdentityError()` for error detection

These provide consistent error handling across the identity context.

## Comparison with Other Contexts

### Property Context (Standard Pattern)

- `types.ts` - Defines `Property` entity
- `constructors.ts` - `buildProperty()` with validation
- **Owns** the Property entity and its creation logic

### Identity Context (Wrapper Pattern)

- `domain/types.ts` - **Not present** (types come from better-auth)
- `domain/constructors.ts` - **Not present** (delegates to better-auth)
- `application/ports/identity.port.ts` - Defines adapter types
- **Wraps** better-auth entities, doesn't own them

## When to Add types.ts or constructors.ts

If the identity context evolves to have domain entities that **are not** provided by better-auth, then add these files:

**Example scenarios:**

- Custom `Profile` entity with user preferences (not in better-auth)
- `Permission` entity with fine-grained permissions (not in better-auth)
- `AuditLog` entity for identity operations (not in better-auth)

For these scenarios:

1. Add `types.ts` with the entity definition
2. Add `constructors.ts` with smart constructors
3. Update `rules.ts` with validation rules
4. Update `events.ts` with domain events

## Summary

The identity context is intentionally designed as a **thin wrapper/adapter** around better-auth. It provides:

- Domain validation rules for better-auth operations
- Domain events for tracking identity changes
- Domain errors for consistent error handling
- A port abstraction to decouple from better-auth

It does **not** provide:

- Domain types (come from better-auth)
- Smart constructors (delegates to better-auth)

This is the correct architectural choice for a wrapper context and maintains the separation between the external library (better-auth) and our domain logic.
