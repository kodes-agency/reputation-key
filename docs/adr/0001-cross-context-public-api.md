# Cross-context communication through typed PublicApi surfaces

**Status:** Accepted

Contexts communicate through typed `PublicApi` surfaces defined in each context's `application/` layer. No context imports another context's repositories, use cases, or internal domain functions. Cross-context data needs (property existence checks, staff access filtering) are exposed as functions on the providing context's PublicApi and injected as dependencies into consuming contexts' `build.ts` functions by the composition root.

This replaces the previous pattern of placing cross-context interface types in `shared/domain/` (e.g., `PropertyAccessProvider`) and building ad-hoc adapter closures in `composition.ts`. Those were temporary expedients that worked with two consumers but don't scale — every new thick context (review, metric, gamification) would add more duplicated adapters and more lines to the monolithic `buildUseCases()`.

## What changed

- Each context owns a `build.ts` that wires its own repositories and use cases. The composition root assembles contexts in dependency order and passes PublicApi surfaces between them.
- `PropertyPublicApi` (`propertyExists`) and `StaffPublicApi` (`getAccessiblePropertyIds`) are the only PublicApis currently needed. Other contexts (identity, team, portal) have no synchronous cross-context consumers and don't expose a PublicApi. If that changes, the file is created at that point — not before.
- `shared/domain/property-access.port.ts` is deleted. The concept becomes `StaffPublicApi.getAccessiblePropertyIds`.
- `team/application/ports/property-exists.port.ts` is deleted. The concept becomes `PropertyPublicApi.propertyExists`.
- The invitation-acceptance hook (identity → staff on invite accept) remains a composition-level callback, not a PublicApi. This migrates to domain events when cross-context event handlers are production-ready.

## Considered options

- **Raw repo sharing** (previous pattern): contexts import other contexts' repository types directly. Rejected — creates hidden coupling, makes independent testing impossible, and the composition root becomes a monolith that every context change touches.
- **Shared/domain port types** (intermediate pattern): cross-context interfaces live in `shared/domain/`. Works for one or two consumers, but each new cross-context relationship adds another file to shared and another adapter closure to composition. The shared layer becomes a dumping ground for things that don't belong to any single context.
- **Domain events for everything**: all cross-context communication goes through the event bus. Rejected for now — event handlers aren't production-ready yet, and synchronous queries like `propertyExists` shouldn't be forced async. Events are the right model for eventual-consistency concerns (invitation acceptance, audit trails), not for request-scoped validation.

## Consequences

- Adding a new cross-context dependency means defining a method on the provider's PublicApi and adding the dep to the consumer's `build.ts`. The composition root passes it through. No other files change.
- Each context's `build.ts` is the single place its wiring lives. Working on portal means loading only `portal/build.ts`, not a 400-line monolith.
- The construction order in `composition.ts` reflects the actual dependency DAG. Circular dependencies between contexts are structurally prevented — you can't pass a PublicApi if the provider hasn't been built yet.
- New contexts (review, metric) follow the same pattern: define a PublicApi if other contexts query them, consume existing PublicApis if they query others. The composition root adds one line per context.
