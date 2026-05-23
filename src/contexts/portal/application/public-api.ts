/**
 * Public API for external consumers (components, routes, other contexts).
 * Re-exports ports for cross-context dependency injection.
 */
export type { StoragePort } from './ports/storage.port'
export type { LinkResolverPort } from './ports/link-resolver.port'

// Event re-exports — cross-context consumers must import events from public-api, not domain/events
export type { PortalDeleted, PortalEvent } from '../domain/events'
export { portalDeleted } from '../domain/events'
