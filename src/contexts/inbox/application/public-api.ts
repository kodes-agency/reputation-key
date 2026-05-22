/**
 * Public API for external consumers (components, routes).
 * Re-exports domain types. Per boundary rules: components may import
 * from `application/` but NOT from `domain/`.
 */
export type { InboxItem, InboxNote, InboxItemDetail, InboxStatus, SourceType } from '../domain/types'
export type { InboxError, InboxErrorCode } from '../domain/errors'
export type { Cursor } from './ports/inbox.repository'
