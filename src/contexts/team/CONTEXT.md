# Team Context

## Bounded context

Team management — creation, updates, soft-deletion within a property.

## Glossary

- **Team** — Groups staff within a property. Belongs to an organization and property. Has name, description, optional team lead.
- **Soft Delete** — Teams are soft-deleted (marked `deletedAt`), not hard-deleted.

## Relationships

- Team → Property (required `propertyId`).
- Team → User (optional `teamLeadId`, via identity context).
- Team ← StaffAssignment (staff can be assigned to a team within a property).
- Team context **depends on** `PropertyPublicApi` for property existence validation.
- Team context **depends on** `StaffPublicApi` for accessible property filtering and team member lookups.

## Invariants

- Team names must be non-empty.
- Teams are scoped to a property within an organization.
- Duplicate team names within the same property are forbidden.
- Only PM+ roles can create/update/delete teams.

## Events produced

- **`team.created`** — teamId, organizationId, propertyId, name, occurredAt, eventId, correlationId.
- **`team.updated`** — teamId, organizationId, propertyId, name, occurredAt, eventId, correlationId.
- **`team.deleted`** — teamId, organizationId, propertyId, occurredAt, eventId, correlationId.

## Events consumed

None. Team context does not subscribe to events from other contexts.

## Architecture layers

```
team/
  domain/              types.ts, constructors.ts, events.ts, errors.ts, rules.ts
  application/
    ports/             team.repository.ts, assignment-check.port.ts
    dto/               create-team.dto.ts, update-team.dto.ts
    use-cases/         create-team.ts, update-team.ts, list-teams.ts,
                       soft-delete-team.ts
    public-api.ts      re-exports domain types, event types/constructors
  infrastructure/
    repositories/      team.repository.ts (Drizzle)
    mappers/           team.mapper.ts
  server/              teams.ts
  build.ts             composition root
```

## Use cases

- **`createTeam`** — Create a new team within a property. Validates property exists via PropertyPublicApi.
- **`updateTeam`** — Update team settings (name, description, team lead).
- **`listTeams`** — List teams for an org/property, filtered by accessible properties.
- **`softDeleteTeam`** — Soft-delete a team, emits `team.deleted`.

## Public API

Exported from `application/public-api.ts`:

- Types: `Team`, `TeamId`, `TeamPublicApi`
- Event types: `TeamCreated`, `TeamUpdated`, `TeamDeleted`, `TeamEvent`
- Event constructors: `teamCreated`, `teamUpdated`, `teamDeleted`

## Server functions

- **`teams.ts`** — Server functions for teams (create, update, list, delete).

## Permissions

Team context uses the following permissions from `shared/domain/permissions.ts`:

- `team.read` — List/view teams (actively enforced in listTeams server function via `can(ctx.role, 'team.read')`)
- `team.create` — Create a new team within a property (AccountAdmin, PropertyManager)
- `team.update` — Update team settings (AccountAdmin, PropertyManager)
- `team.delete` — Soft-delete a team (AccountAdmin only)
