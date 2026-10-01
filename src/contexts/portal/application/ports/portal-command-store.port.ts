// Portal command store — one authoritative state + lifecycle-fact boundary.
//
// Production commits each command's Portal rows and every required outbox row
// in one PostgreSQL transaction.

import type { GuestLocale } from '#/shared/domain/guest-locale'
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
  PortalAccessArtifactPublished,
  PortalArchived,
  PortalLocaleSetUpdated,
  PortalPublicationPublished,
  PortalPublicationRolledBack,
  PortalRestored,
} from '../../domain/events'
import type { PortalLinkTextProvenance } from '../../domain/portal-linktree'
import type { PortalToken } from '../../domain/portal-token'
import type { SealedPortalAddress } from './portal-address-cipher.port'
import type { PortalAccessArtifact } from '../../domain/portal-access-artifact'
import type { PortalHealth } from '../../domain/portal-health'

/** The wording of one language of a Portal being started from another. */
export type CopiedPortalOverride = Readonly<{
  id: string
  locale: GuestLocale
  title: string | null
  shortDescription: string | null
  linktreeTitle: string | null
}>

/**
 * What a new Portal takes over from the Portal it is started from: wording,
 * links and their texts, all with fresh identifiers that belong to the new
 * Portal. Never codes, publication snapshots or responsible managers.
 */
export type CreatePortalCopiedContent = Readonly<{
  sourcePortalId: PortalId
  overrides: ReadonlyArray<CopiedPortalOverride>
  categories: ReadonlyArray<PortalLinkCategory>
  links: ReadonlyArray<PortalLink>
  linkTexts: ReadonlyArray<Readonly<{ linkId: PortalLinkId }> & PortalLinkTextWrite>
}>

/** The Portal joins a group in the same commit, fencing the group like a membership change. */
export type CreatePortalGroupMembership = Readonly<{
  portalGroupId: PortalGroupId
  expectedGroupUpdatedAt: Date
  revision: Date
  event: PortalAddedToGroup
}>

export type CreatePortalCommand = Readonly<{
  organizationId: OrganizationId
  portal: Portal
  /** Who is responsible from the start; empty means nobody, and the recovery fact is required. */
  initialResponsibleManagerIds: ReadonlyArray<UserId>
  event: PortalCreated
  groupMembership?: CreatePortalGroupMembership
  copiedContent?: CreatePortalCopiedContent
  responsibilityNeededEvent?: PortalResponsibilityNeeded
  health?: Readonly<{
    id: string
    value: PortalHealth
    sourceVersion: string
    effectiveAt: Date
    observedAt: Date
  }>
}>

export type UpdatePortalCommand = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  /** Authenticated actor whose identity may be retained in semantic lifecycle facts. */
  actorUserId: UserId
  /** Optimistic fence captured by the application pre-read. */
  expectedUpdatedAt: Date
  /** Monotonic aggregate revision; may be later than business occurrence time. */
  revision: Date
  /** Actual business time returned by the command clock. */
  occurredAt: Date
  patch: Readonly<Omit<Partial<Portal>, 'updatedAt'>>
  publication?: PortalPublicationMutation
  health?: Readonly<{
    id: string
    value: PortalHealth
    sourceVersion: string
    effectiveAt: Date
    observedAt: Date
  }>
  localeSetEvent?: PortalLocaleSetUpdated
  /** Required semantic fact for publish, rollback, archive, and restore transitions. */
  lifecycleEvent?: PortalSemanticLifecycleEvent
  event: PortalUpdated
}>

export type PortalSemanticLifecycleEvent =
  | PortalPublicationPublished
  | PortalPublicationRolledBack
  | PortalArchived
  | PortalRestored

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
      publicationDigest: string
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
  /** Who archived the group; recorded in the group's history. */
  changedBy: UserId
  event: PortalGroupDeleted
}>

/** The group a Portal leaves in a move, with the fact that says so. */
export type PortalGroupDeparture = Readonly<{
  portalGroupId: PortalGroupId
  event: PortalRemovedFromGroup
}>

/**
 * A group that loses Portals in a move. Fenced once, however many Portals leave
 * it, and fenced in sorted id order with every other group the command touches.
 */
export type PortalGroupSourceFence = Readonly<{
  portalGroupId: PortalGroupId
  expectedUpdatedAt: Date
  revision: Date
}>

export type CreatePortalGroupCommand = Readonly<{
  organizationId: OrganizationId
  group: PortalGroup
  /** Who created the group; recorded in its history. */
  changedBy: UserId
  memberships: ReadonlyArray<
    Readonly<{
      portalId: PortalId
      createdBy: UserId
      /** Set when the Portal is in another group, which it leaves in this commit. */
      movedFrom: PortalGroupDeparture | null
    }>
  >
  /** One fence per group that loses a Portal to the new group. */
  sourceGroups: ReadonlyArray<PortalGroupSourceFence>
  events: readonly [PortalGroupCreated, ...PortalAddedToGroup[]]
}>

export type UpdatePortalGroupCommand = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalGroupId: PortalGroupId
  expectedUpdatedAt: Date
  name: string
  /** The name before this command, recorded in the group's history. */
  previousName: string
  changedBy: UserId
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

/**
 * Move a Portal to another group in one commit: the membership it held ends
 * with `moved_to_group` and a new one begins. `from` is null when the Portal had
 * no group, which makes the command a plain addition. Both groups are fenced,
 * in sorted id order.
 */
export type MovePortalToGroupCommand = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  changedBy: UserId
  occurredAt: Date
  to: PortalGroupSourceFence & Readonly<{ event: PortalAddedToGroup }>
  from: (PortalGroupSourceFence & Readonly<{ event: PortalRemovedFromGroup }>) | null
}>

type PortalContentCommandBase = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  expectedPortalUpdatedAt: Date
  revision: Date
  occurredAt: Date
}>

/**
 * A change to what a Portal's page shows: it opens a pending-change fence and
 * writes the page-edit ledger row, so it names who made it.
 */
type PortalPageEditCommandBase = PortalContentCommandBase &
  Readonly<{ actorUserId: UserId }>

export type CreatePortalLinkCategoryCommand = PortalPageEditCommandBase &
  Readonly<{
    category: PortalLinkCategory
    event: PortalLinkCategoryCreated
  }>

export type ReorderPortalLinkCategoriesCommand = PortalPageEditCommandBase &
  Readonly<{
    updates: ReadonlyArray<Readonly<{ id: PortalLinkCategoryId; sortKey: string }>>
    event: PortalLinkCategoryReordered
  }>

export type UpdatePortalLinkCategoryCommand = PortalPageEditCommandBase &
  Readonly<{
    categoryId: PortalLinkCategoryId
    title: string
    event: PortalLinkCategoryUpdated
  }>

export type DeletePortalLinkCategoryCommand = PortalPageEditCommandBase &
  Readonly<{
    categoryId: PortalLinkCategoryId
    event: PortalLinkCategoryDeleted
  }>

export type CreatePortalLinkCommand = PortalContentCommandBase &
  Readonly<{
    /** Who wrote the link; recorded on its primary-language text. */
    actorUserId: UserId
    link: PortalLink
    event: PortalLinkCreated
    /**
     * The Portal's first category, when the link starts it. Written in the same
     * transaction and under the same fence as the link, so a refused link leaves
     * neither the category nor its fact behind. The link's `categoryId` is its id.
     */
    startCategory?: Readonly<{
      category: PortalLinkCategory
      event: PortalLinkCategoryCreated
    }>
  }>

export type ReorderPortalLinksCommand = PortalPageEditCommandBase &
  Readonly<{
    categoryId: PortalLinkCategoryId
    updates: ReadonlyArray<Readonly<{ id: PortalLinkId; sortKey: string }>>
    event: PortalLinkReordered
  }>

export type UpdatePortalLinkCommand = PortalContentCommandBase &
  Readonly<{
    /** Who changed the link; recorded on its primary-language text. */
    actorUserId: UserId
    linkId: PortalLinkId
    categoryId: PortalLinkCategoryId
    patch: Readonly<
      Pick<
        PortalLink,
        'label' | 'url' | 'destinationId' | 'legacyDestinationState' | 'iconKey'
      >
    >
    event: PortalLinkUpdated
  }>

/** One language of one link, already validated and trimmed. */
export type PortalLinkTextWrite = Readonly<{
  locale: GuestLocale
  label: string
  line: string | null
  provenance: PortalLinkTextProvenance | null
}>

/**
 * Write the per-language texts of one link. The primary-language label is also
 * written to the link's own `label` (the legacy column) in the same commit.
 */
export type SavePortalLinkTextsCommand = PortalContentCommandBase &
  Readonly<{
    actorUserId: UserId
    linkId: PortalLinkId
    categoryId: PortalLinkCategoryId
    texts: ReadonlyArray<PortalLinkTextWrite>
    event: PortalLinkUpdated
  }>

/**
 * The link section's own settings: the on/off switch and a title per language
 * (null resets that language to the pack's default). Either part may be absent.
 */
export type SavePortalLinktreeSettingsCommand = PortalContentCommandBase &
  Readonly<{
    actorUserId: UserId
    enabled?: boolean
    titles?: ReadonlyArray<
      Readonly<{
        locale: GuestLocale
        title: string | null
        /** Identifier for the override row if this save has to create one. */
        overrideId: string
      }>
    >
    event: PortalUpdated
  }>

export type DeletePortalLinkCommand = PortalPageEditCommandBase &
  Readonly<{
    linkId: PortalLinkId
    categoryId: PortalLinkCategoryId
    event: PortalLinkDeleted
  }>

type PortalTokenCommandBase = PortalContentCommandBase

/**
 * What a command that makes a code also carries (ADR 0064): who made it, and
 * the sealed copy of its address when a keyring is configured. The store writes
 * both with the token row, so a code never exists without its owner's record.
 */
type PortalCodeProvenance = Readonly<{
  issuedBy: UserId
  sealedAddress: SealedPortalAddress | null
}>

export type IssuePortalTokenCommand = PortalTokenCommandBase &
  PortalCodeProvenance &
  Readonly<{
    token: PortalToken
    accessArtifacts: readonly [PortalAccessArtifact, PortalAccessArtifact]
    event: PortalTokenIssued
    accessArtifactEvents: readonly [
      PortalAccessArtifactPublished,
      PortalAccessArtifactPublished,
    ]
  }>

/** Rotation clears the outgoing code's sealed address and seals the new one. */
export type RotatePortalTokenCommand = PortalTokenCommandBase &
  PortalCodeProvenance &
  Readonly<{
    oldToken: PortalToken
    newToken: PortalToken
    accessArtifacts: readonly [PortalAccessArtifact, PortalAccessArtifact]
    event: PortalTokenRotated
    accessArtifactEvents: readonly [
      PortalAccessArtifactPublished,
      PortalAccessArtifactPublished,
    ]
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
  movePortalToGroup(command: MovePortalToGroupCommand): Promise<void>
  createPortalLinkCategory(command: CreatePortalLinkCategoryCommand): Promise<void>
  updatePortalLinkCategory(command: UpdatePortalLinkCategoryCommand): Promise<void>
  deletePortalLinkCategory(command: DeletePortalLinkCategoryCommand): Promise<void>
  reorderPortalLinkCategories(command: ReorderPortalLinkCategoriesCommand): Promise<void>
  createPortalLink(command: CreatePortalLinkCommand): Promise<void>
  updatePortalLink(command: UpdatePortalLinkCommand): Promise<void>
  deletePortalLink(command: DeletePortalLinkCommand): Promise<void>
  reorderPortalLinks(command: ReorderPortalLinksCommand): Promise<void>
  savePortalLinkTexts(command: SavePortalLinkTextsCommand): Promise<void>
  savePortalLinktreeSettings(command: SavePortalLinktreeSettingsCommand): Promise<void>
  issuePortalToken(command: IssuePortalTokenCommand): Promise<void>
  rotatePortalToken(command: RotatePortalTokenCommand): Promise<void>
  revokePortalTokens(
    command: RevokePortalTokensCommand,
  ): Promise<Readonly<{ revoked: number }>>
  deletePortalGroup(command: DeletePortalGroupCommand): Promise<void>
}>
