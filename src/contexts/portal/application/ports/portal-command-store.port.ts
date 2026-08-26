// Portal command store — one authoritative state + lifecycle-fact boundary.
//
// Production commits each command's Portal rows and every required outbox row
// in one regional PostgreSQL transaction. The in-process bus is emitted only
// after commit and is never the recovery authority.

import type {
  OrganizationId,
  PortalGroupId,
  PortalId,
  PortalLinkCategoryId,
  PortalLinkId,
  PropertyId,
  UserId,
} from '#/shared/domain/ids'
import type {
  Portal,
  PortalGroup,
  PortalLink,
  PortalLinkCategory,
} from '../../domain/types'
import type {
  PortalPublicationActivation,
  PortalPublicationSnapshot,
} from '../../domain/portal-publication-snapshot'
import type {
  PortalCreated,
  PortalDeleted,
  PortalAddedToGroup,
  PortalGroupCreated,
  PortalGroupUpdated,
  PortalRemovedFromGroup,
  PortalLinkCategoryCreated,
  PortalLinkCategoryDeleted,
  PortalLinkCategoryReordered,
  PortalLinkCategoryUpdated,
  PortalLinkCreated,
  PortalLinkDeleted,
  PortalLinkReordered,
  PortalLinkUpdated,
  PortalTokenIssued,
  PortalTokenRotated,
  PortalTokenRevoked,
  PortalGroupDeleted,
  PortalResponsibilityNeeded,
  PortalUpdated,
} from '../../domain/events'
import type { PortalToken } from '../../domain/portal-token'

export type CreatePortalCommand = Readonly<{
  organizationId: OrganizationId
  portal: Portal
  initialResponsibleManagerId: UserId | null
  event: PortalCreated
  responsibilityNeededEvent?: PortalResponsibilityNeeded
}>

export type UpdatePortalCommand = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  /** Optimistic fence captured by the application pre-read. */
  expectedUpdatedAt: Date
  /** Monotonic aggregate revision; may be later than business occurrence time. */
  revision: Date
  /** Actual business time returned by the command clock. */
  occurredAt: Date
  patch: Readonly<Omit<Partial<Portal>, 'updatedAt'>>
  publication?: PortalPublicationMutation
  event: PortalUpdated
}>

export type PortalPublicationMutation =
  | Readonly<{
      kind: 'publish'
      snapshot: PortalPublicationSnapshot
      activation: PortalPublicationActivation & Readonly<{ kind: 'publish' }>
    }>
  | Readonly<{
      kind: 'rollback'
      snapshotId: string
      snapshotVersion: number
      activation: PortalPublicationActivation & Readonly<{ kind: 'rollback' }>
    }>
  | Readonly<{
      kind: 'deactivate'
      reason: 'disabled' | 'archived'
      at: Date
    }>

export type DeletePortalCommand = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  /** Optimistic fence captured by the application pre-read. */
  expectedUpdatedAt: Date
  revokedBy: UserId
  reason: string
  revision: Date
  occurredAt: Date
  event: PortalDeleted
  /** Recorded only when the transaction actually revokes a live token. */
  tokenRevokedEvent: PortalTokenRevoked
}>

export type DeletePortalGroupCommand = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalGroupId: PortalGroupId
  /** Optimistic fence captured by the application pre-read. */
  expectedUpdatedAt: Date
  revision: Date
  occurredAt: Date
  event: PortalGroupDeleted
}>

export type CreatePortalGroupCommand = Readonly<{
  organizationId: OrganizationId
  group: PortalGroup
  memberships: ReadonlyArray<
    Readonly<{
      portalId: PortalId
      createdBy: UserId
    }>
  >
  events: readonly [PortalGroupCreated, ...PortalAddedToGroup[]]
}>

export type UpdatePortalGroupCommand = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalGroupId: PortalGroupId
  expectedUpdatedAt: Date
  name: string
  revision: Date
  occurredAt: Date
  event: PortalGroupUpdated
}>

export type ChangePortalGroupMembershipCommand = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalGroupId: PortalGroupId
  portalId: PortalId
  expectedUpdatedAt: Date
  revision: Date
  occurredAt: Date
  changedBy: UserId
}>

export type AddPortalToGroupCommand = ChangePortalGroupMembershipCommand &
  Readonly<{ event: PortalAddedToGroup }>

export type RemovePortalFromGroupCommand = ChangePortalGroupMembershipCommand &
  Readonly<{ event: PortalRemovedFromGroup }>

type PortalContentCommandBase = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  expectedPortalUpdatedAt: Date
  revision: Date
  occurredAt: Date
}>

export type CreatePortalLinkCategoryCommand = PortalContentCommandBase &
  Readonly<{
    category: PortalLinkCategory
    event: PortalLinkCategoryCreated
  }>

export type ReorderPortalLinkCategoriesCommand = PortalContentCommandBase &
  Readonly<{
    updates: ReadonlyArray<Readonly<{ id: PortalLinkCategoryId; sortKey: string }>>
    event: PortalLinkCategoryReordered
  }>

export type UpdatePortalLinkCategoryCommand = PortalContentCommandBase &
  Readonly<{
    categoryId: PortalLinkCategoryId
    title: string
    event: PortalLinkCategoryUpdated
  }>

export type DeletePortalLinkCategoryCommand = PortalContentCommandBase &
  Readonly<{
    categoryId: PortalLinkCategoryId
    event: PortalLinkCategoryDeleted
  }>

export type CreatePortalLinkCommand = PortalContentCommandBase &
  Readonly<{
    link: PortalLink
    event: PortalLinkCreated
  }>

export type ReorderPortalLinksCommand = PortalContentCommandBase &
  Readonly<{
    categoryId: PortalLinkCategoryId
    updates: ReadonlyArray<Readonly<{ id: PortalLinkId; sortKey: string }>>
    event: PortalLinkReordered
  }>

export type UpdatePortalLinkCommand = PortalContentCommandBase &
  Readonly<{
    linkId: PortalLinkId
    categoryId: PortalLinkCategoryId
    patch: Readonly<{ label: string; url: string; iconKey: string | null }>
    event: PortalLinkUpdated
  }>

export type DeletePortalLinkCommand = PortalContentCommandBase &
  Readonly<{
    linkId: PortalLinkId
    categoryId: PortalLinkCategoryId
    event: PortalLinkDeleted
  }>

type PortalTokenCommandBase = PortalContentCommandBase

export type IssuePortalTokenCommand = PortalTokenCommandBase &
  Readonly<{
    token: PortalToken
    event: PortalTokenIssued
  }>

export type RotatePortalTokenCommand = PortalTokenCommandBase &
  Readonly<{
    oldToken: PortalToken
    newToken: PortalToken
    event: PortalTokenRotated
  }>

export type RevokePortalTokensCommand = PortalTokenCommandBase &
  Readonly<{
    revokedBy: UserId
    reason: string
    event: PortalTokenRevoked
  }>

export type PortalCommandStore = Readonly<{
  createPortal(command: CreatePortalCommand): Promise<void>
  updatePortal(command: UpdatePortalCommand): Promise<void>
  deletePortal(command: DeletePortalCommand): Promise<Readonly<{ revoked: number }>>
  createPortalGroup(command: CreatePortalGroupCommand): Promise<void>
  updatePortalGroup(command: UpdatePortalGroupCommand): Promise<void>
  addPortalToGroup(command: AddPortalToGroupCommand): Promise<void>
  removePortalFromGroup(command: RemovePortalFromGroupCommand): Promise<void>
  createPortalLinkCategory(command: CreatePortalLinkCategoryCommand): Promise<void>
  updatePortalLinkCategory(command: UpdatePortalLinkCategoryCommand): Promise<void>
  deletePortalLinkCategory(command: DeletePortalLinkCategoryCommand): Promise<void>
  reorderPortalLinkCategories(command: ReorderPortalLinkCategoriesCommand): Promise<void>
  createPortalLink(command: CreatePortalLinkCommand): Promise<void>
  updatePortalLink(command: UpdatePortalLinkCommand): Promise<void>
  deletePortalLink(command: DeletePortalLinkCommand): Promise<void>
  reorderPortalLinks(command: ReorderPortalLinksCommand): Promise<void>
  issuePortalToken(command: IssuePortalTokenCommand): Promise<void>
  rotatePortalToken(command: RotatePortalTokenCommand): Promise<void>
  revokePortalTokens(
    command: RevokePortalTokensCommand,
  ): Promise<Readonly<{ revoked: number }>>
  deletePortalGroup(command: DeletePortalGroupCommand): Promise<void>
}>
