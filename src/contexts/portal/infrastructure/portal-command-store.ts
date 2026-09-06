// Atomic Portal command store (ARC-01).
//
// Portal state, responsibility/token side effects, and every required durable
// lifecycle fact commit together in one PostgreSQL transaction.

import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  portalPublicationActivations,
  portalPublicationSnapshots,
  portalLinkCategories,
  portalLinks,
  portalResponsibleManagers,
  portalAccessArtifacts,
  portalApprovedDestinations,
  portalLocalizedOverrides,
  propertyPortalBrandContents,
  propertyPortalBrandProfiles,
  portalHealthIntervals,
  portals,
  portalTokens,
} from '#/shared/db/schema/portal.schema'
import { portalGroups } from '#/shared/db/schema/portal-group.schema'
import { portalGroupMemberships } from '#/shared/db/schema/people-access.schema'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import { lockPortalPublicationProperty } from './portal-publication-serialization'
import {
  recordPortalPendingContentChange,
  resolvePortalPendingContentChanges,
} from './portal-pending-content-changes'
import { trace } from '#/shared/observability/trace'
import { unbrand } from '#/shared/domain/ids'
import type {
  CreatePortalCommand,
  CreatePortalGroupCommand,
  CreatePortalLinkCategoryCommand,
  CreatePortalLinkCommand,
  DeletePortalLinkCategoryCommand,
  DeletePortalLinkCommand,
  AddPortalToGroupCommand,
  DeletePortalCommand,
  DeletePortalGroupCommand,
  RemovePortalFromGroupCommand,
  ReorderPortalLinkCategoriesCommand,
  ReorderPortalLinksCommand,
  IssuePortalTokenCommand,
  RotatePortalTokenCommand,
  RevokePortalTokensCommand,
  PortalCommandStore,
  PortalPublicationMutation,
  PortalSemanticLifecycleEvent,
  UpdatePortalCommand,
  UpdatePortalGroupCommand,
  UpdatePortalLinkCategoryCommand,
  UpdatePortalLinkCommand,
} from '../application/ports/portal-command-store.port'
import type { Portal, PortalTheme } from '../domain/types'
import { portalError } from '../domain/errors'
import { portalToRow } from './mappers/portal.mapper'
import { portalGroupToRow } from './mappers/portal-group.mapper'
import { categoryToRow, linkToRow } from './mappers/portal-link.mapper'
import { verifyPortalPublicationSnapshot } from '../application/portal-publication-snapshot'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'

type PortalSetValues = {
  name?: string
  slug?: string
  description?: string | null
  heroImageUrl?: string | null
  theme?: Record<string, unknown>
  privateFeedbackThreshold?: number
  publicationState?: Portal['publicationState']
  primaryGuestLocale?: Portal['primaryGuestLocale']
  additionalGuestLocales?: Portal['additionalGuestLocales']
  updatedAt?: Date
}

const PORTAL_WORKING_COPY_FIELDS: ReadonlySet<string> = new Set([
  'name',
  'slug',
  'description',
  'heroImageUrl',
  'theme',
  'privateFeedbackThreshold',
  'primaryGuestLocale',
  'additionalGuestLocales',
])

function hasPortalWorkingCopyPatch(patch: UpdatePortalCommand['patch']): boolean {
  return Object.keys(patch).some((key) => PORTAL_WORKING_COPY_FIELDS.has(key))
}

async function recordPortalContentCommandPending(
  tx: Tx,
  command: Readonly<{
    organizationId: UpdatePortalCommand['organizationId']
    propertyId: UpdatePortalCommand['propertyId']
    portalId: UpdatePortalCommand['portalId']
    revision: Date
    occurredAt: Date
  }>,
): Promise<void> {
  await recordPortalPendingContentChange(tx, {
    organizationId: unbrand(command.organizationId),
    propertyId: unbrand(command.propertyId),
    portalId: unbrand(command.portalId),
    kind: 'portal_links',
    sourceVersion: command.revision.toISOString(),
    changedAt: command.occurredAt,
  })
}

const sameInstant = (left: Date, right: Date): boolean =>
  left.getTime() === right.getTime()

function assertCommittedRevision(
  persisted: Readonly<{ updatedAt: Date }> | undefined,
  expected: Date,
  aggregate: 'Portal' | 'Portal Group',
  conflictMessage: string,
): void {
  if (!persisted) {
    throw portalError('revision_conflict', conflictMessage)
  }
  if (!sameInstant(persisted.updatedAt, expected)) {
    throw portalError(
      'revision_conflict',
      `${aggregate} database revision diverged from its durable fact version`,
    )
  }
}

/** The `portal.created` fact must name exactly the Portal being written. */
function matchesPortalCreationScope(command: CreatePortalCommand): boolean {
  const { portal, event } = command
  return (
    portal.organizationId === command.organizationId &&
    event.organizationId === command.organizationId &&
    event.propertyId === portal.propertyId &&
    event.portalId === portal.id &&
    event.publicationState === portal.publicationState &&
    event.sourceAggregateVersion === portal.updatedAt.toISOString() &&
    sameInstant(event.occurredAt, portal.createdAt)
  )
}

/** Initial Health may only assert the Draft posture, pinned to the creation revision. */
function matchesInitialDraftHealth(
  health: NonNullable<CreatePortalCommand['health']>,
  portal: CreatePortalCommand['portal'],
): boolean {
  return (
    health.sourceVersion === portal.updatedAt.toISOString() &&
    sameInstant(health.effectiveAt, portal.createdAt) &&
    health.value.status === 'unavailable' &&
    health.value.reason === 'publication_draft'
  )
}

/** The recovery fact must carry the same scope and revision as the Portal it covers. */
function matchesResponsibilityFactScope(
  fact: NonNullable<CreatePortalCommand['responsibilityNeededEvent']>,
  command: CreatePortalCommand,
): boolean {
  const { portal } = command
  return (
    fact.organizationId === command.organizationId &&
    fact.propertyId === portal.propertyId &&
    fact.portalId === portal.id &&
    fact.sourceAggregateVersion === portal.updatedAt.toISOString() &&
    sameInstant(fact.occurredAt, portal.createdAt)
  )
}

function assertCreateCommand(command: CreatePortalCommand): void {
  const { portal, responsibilityNeededEvent, initialResponsibleManagerId } = command
  if (!matchesPortalCreationScope(command)) {
    throw portalError('forbidden', 'Tenant or resource mismatch on Portal creation')
  }
  const needsResponsibility = initialResponsibleManagerId === null
  if (
    needsResponsibility !== Boolean(responsibilityNeededEvent) ||
    needsResponsibility !== (portal.responsibilityNeededSince !== null)
  ) {
    throw portalError(
      'revision_conflict',
      'Portal responsibility state and recovery fact must be committed together',
    )
  }
  if (command.health && !matchesInitialDraftHealth(command.health, portal)) {
    throw portalError('forbidden', 'Initial Portal Health does not match Draft state')
  }
  if (
    initialResponsibleManagerId !== null &&
    portal.createdBy !== initialResponsibleManagerId
  ) {
    throw portalError(
      'responsible_manager_ineligible',
      'initial responsible manager must be the eligible Portal creator',
    )
  }
  if (
    responsibilityNeededEvent &&
    !matchesResponsibilityFactScope(responsibilityNeededEvent, command)
  ) {
    throw portalError(
      'forbidden',
      'Tenant or resource mismatch on Portal responsibility fact',
    )
  }
}

function buildPortalSetClause(patch: Readonly<Partial<Portal>>): PortalSetValues {
  const set: PortalSetValues = {}
  if (patch.name !== undefined) set.name = patch.name
  if (patch.slug !== undefined) set.slug = patch.slug
  if (patch.description !== undefined) set.description = patch.description
  if (patch.heroImageUrl !== undefined) set.heroImageUrl = patch.heroImageUrl
  if (patch.theme !== undefined)
    set.theme = patch.theme as PortalTheme as Record<string, unknown>
  if (patch.privateFeedbackThreshold !== undefined)
    set.privateFeedbackThreshold = patch.privateFeedbackThreshold
  if (patch.publicationState !== undefined) set.publicationState = patch.publicationState
  if (patch.primaryGuestLocale !== undefined)
    set.primaryGuestLocale = patch.primaryGuestLocale
  if (patch.additionalGuestLocales !== undefined)
    set.additionalGuestLocales = patch.additionalGuestLocales
  return set
}

/** The `portal.updated` fact must name this Portal at this revision, and revisions only advance. */
function assertUpdateScopeAndRevision(command: UpdatePortalCommand): void {
  const nextPublicationState =
    command.patch.publicationState ?? command.event.previousPublicationState
  if (
    command.event.organizationId !== command.organizationId ||
    command.event.propertyId !== command.propertyId ||
    command.event.portalId !== command.portalId ||
    command.event.publicationState !== nextPublicationState ||
    command.event.sourceAggregateVersion !== command.revision.toISOString() ||
    !sameInstant(command.event.occurredAt, command.occurredAt)
  ) {
    throw portalError(
      'forbidden',
      'Tenant, resource, or version mismatch on Portal update',
    )
  }
  if (command.revision.getTime() <= command.expectedUpdatedAt.getTime()) {
    throw portalError(
      'revision_conflict',
      'Portal command revision must advance monotonically',
    )
  }
}

/** An emitted locale-set fact must restate exactly the locales this patch writes. */
function assertLocaleSetFact(command: UpdatePortalCommand): void {
  const fact = command.localeSetEvent
  if (!fact) return
  if (
    fact.organizationId !== command.organizationId ||
    fact.propertyId !== command.propertyId ||
    fact.portalId !== command.portalId ||
    fact.sourceAggregateVersion !== command.revision.toISOString() ||
    !sameInstant(fact.occurredAt, command.occurredAt) ||
    fact.primaryGuestLocale !== command.patch.primaryGuestLocale ||
    JSON.stringify(fact.additionalGuestLocales) !==
      JSON.stringify(command.patch.additionalGuestLocales)
  ) {
    throw portalError('forbidden', 'Portal locale-set fact does not match its update')
  }
}

type PortalStateTransition = Readonly<{
  previous: Portal['publicationState']
  next: Portal['publicationState']
}>

/** A publish activation and its immutable snapshot must share the Portal's scope. */
function assertPublishActivation(
  command: UpdatePortalCommand,
  publication: Extract<PortalPublicationMutation, { kind: 'publish' }>,
  transition: PortalStateTransition,
): void {
  const { snapshot, activation } = publication
  if (
    transition.previous === 'published' ||
    transition.next !== 'published' ||
    snapshot.organizationId !== unbrand(command.organizationId) ||
    snapshot.propertyId !== unbrand(command.propertyId) ||
    snapshot.portalId !== unbrand(command.portalId) ||
    activation.organizationId !== snapshot.organizationId ||
    activation.propertyId !== snapshot.propertyId ||
    activation.portalId !== snapshot.portalId ||
    activation.snapshotId !== snapshot.id ||
    activation.deactivatedAt !== null ||
    activation.deactivationReason !== null ||
    activation.activatedBy !== snapshot.createdBy ||
    !verifyPortalPublicationSnapshot(snapshot) ||
    !sameInstant(snapshot.createdAt, command.occurredAt) ||
    !sameInstant(activation.activatedAt, command.occurredAt)
  ) {
    throw portalError(
      'publication_snapshot_unavailable',
      'Publication snapshot, activation, and Portal state do not share one scope',
    )
  }
}

/** A rollback re-activates an earlier snapshot without leaving the Published state. */
function assertRollbackActivation(
  command: UpdatePortalCommand,
  publication: Extract<PortalPublicationMutation, { kind: 'rollback' }>,
  transition: PortalStateTransition,
): void {
  const { activation } = publication
  if (
    transition.previous !== 'published' ||
    transition.next !== 'published' ||
    publication.snapshotId !== activation.snapshotId ||
    publication.snapshotVersion < 1 ||
    !/^[0-9a-f]{64}$/u.test(publication.publicationDigest) ||
    activation.organizationId !== unbrand(command.organizationId) ||
    activation.propertyId !== unbrand(command.propertyId) ||
    activation.portalId !== unbrand(command.portalId) ||
    activation.deactivatedAt !== null ||
    activation.deactivationReason !== null ||
    !sameInstant(activation.activatedAt, command.occurredAt)
  ) {
    throw portalError(
      'publication_snapshot_unavailable',
      'Rollback activation does not match the current Portal scope',
    )
  }
}

/**
 * Both directions of the publication/state coupling: a transition that needs a
 * publication mutation must carry one, and a carried mutation must match the
 * transition it accompanies.
 */
function assertPublicationTransition(command: UpdatePortalCommand): void {
  const previous = command.event.previousPublicationState
  const next = command.event.publicationState
  const transition: PortalStateTransition = { previous, next }
  const publication = command.publication
  if (
    next === 'published' &&
    previous !== 'published' &&
    publication?.kind !== 'publish'
  ) {
    throw portalError(
      'publication_snapshot_unavailable',
      'A new immutable snapshot is required before publishing',
    )
  }
  if (
    previous === 'published' &&
    (next === 'disabled' || next === 'archived') &&
    (publication?.kind !== 'deactivate' || publication.reason !== next)
  ) {
    throw portalError(
      'publication_snapshot_unavailable',
      'The active publication must close with the Portal state transition',
    )
  }
  if (publication?.kind === 'publish') {
    assertPublishActivation(command, publication, transition)
  }
  if (publication?.kind === 'rollback') {
    assertRollbackActivation(command, publication, transition)
  }
  if (
    publication?.kind === 'deactivate' &&
    (!sameInstant(publication.at, command.occurredAt) ||
      previous !== 'published' ||
      next === 'published')
  ) {
    throw portalError(
      'publication_snapshot_unavailable',
      'Publication deactivation does not match the Portal state transition',
    )
  }
}

/** A Health fact written with an update is pinned to that update's revision and time. */
function assertUpdateHealthFact(command: UpdatePortalCommand): void {
  const health = command.health
  if (!health) return
  if (
    health.sourceVersion !== command.revision.toISOString() ||
    !sameInstant(health.effectiveAt, command.occurredAt) ||
    health.observedAt < health.effectiveAt
  ) {
    throw portalError('forbidden', 'Portal Health does not match its command version')
  }
}

function assertUpdateCommand(command: UpdatePortalCommand): void {
  assertUpdateScopeAndRevision(command)
  assertLocaleSetFact(command)
  assertPublicationTransition(command)
  assertUpdateHealthFact(command)
  assertSemanticLifecycleEvent(command)
}

/**
 * The one semantic fact this transition is allowed to carry, or null when the
 * transition is not semantically notable.
 */
function expectedLifecycleTag(
  command: UpdatePortalCommand,
): PortalSemanticLifecycleEvent['_tag'] | null {
  const previous = command.event.previousPublicationState
  const next = command.event.publicationState
  const publication = command.publication
  if (publication?.kind === 'publish') return 'portal.publication.published'
  if (publication?.kind === 'rollback') return 'portal.publication.rolled_back'
  if (previous !== 'archived' && next === 'archived') return 'portal.archived'
  if (previous === 'archived' && next === 'disabled') return 'portal.restored'
  return null
}

function matchesLifecycleEventScope(
  event: PortalSemanticLifecycleEvent,
  command: UpdatePortalCommand,
): boolean {
  return (
    event.organizationId === command.organizationId &&
    event.propertyId === command.propertyId &&
    event.portalId === command.portalId &&
    event.sourceAggregateVersion === command.revision.toISOString() &&
    sameInstant(event.occurredAt, command.occurredAt) &&
    event.userId === command.actorUserId
  )
}

/** A publish/rollback fact must quote the very snapshot the same commit activates. */
function assertLifecyclePayloadMatchesPublication(
  event: PortalSemanticLifecycleEvent,
  publication: PortalPublicationMutation | undefined,
): void {
  if (
    event._tag === 'portal.publication.published' &&
    (publication?.kind !== 'publish' ||
      event.publicationSnapshotId !== publication.snapshot.id ||
      event.publicationVersion !== publication.snapshot.version ||
      event.publicationDigest !== publication.snapshot.configurationDigest ||
      String(event.userId) !== publication.snapshot.createdBy)
  ) {
    throw portalError(
      'forbidden',
      'Portal publication fact does not match its immutable snapshot',
    )
  }
  if (
    event._tag === 'portal.publication.rolled_back' &&
    (publication?.kind !== 'rollback' ||
      event.publicationSnapshotId !== publication.snapshotId ||
      event.publicationVersion !== publication.snapshotVersion ||
      event.publicationDigest !== publication.publicationDigest ||
      String(event.userId) !== publication.activation.activatedBy)
  ) {
    throw portalError(
      'forbidden',
      'Portal rollback fact does not match its target immutable snapshot',
    )
  }
}

function assertSemanticLifecycleEvent(command: UpdatePortalCommand): void {
  const expectedTag = expectedLifecycleTag(command)
  const event = command.lifecycleEvent

  if ((event?._tag ?? null) !== expectedTag) {
    throw portalError(
      'forbidden',
      expectedTag === null
        ? 'Portal update carried an unrelated semantic lifecycle fact'
        : `Portal transition requires ${expectedTag}`,
    )
  }
  if (!event) return
  if (!matchesLifecycleEventScope(event, command)) {
    throw portalError(
      'forbidden',
      'Portal semantic lifecycle fact does not match its committed transition',
    )
  }
  assertLifecyclePayloadMatchesPublication(event, command.publication)
}

async function applyPortalHealthMutation(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  command: UpdatePortalCommand &
    Readonly<{ health: NonNullable<UpdatePortalCommand['health']> }>,
): Promise<void> {
  const [current] = await tx
    .select()
    .from(portalHealthIntervals)
    .where(
      and(
        eq(portalHealthIntervals.organizationId, unbrand(command.organizationId)),
        eq(portalHealthIntervals.propertyId, unbrand(command.propertyId)),
        eq(portalHealthIntervals.portalId, unbrand(command.portalId)),
        isNull(portalHealthIntervals.effectiveTo),
      ),
    )
    .limit(1)
  if (
    current?.status === command.health.value.status &&
    current.reason === command.health.value.reason
  ) {
    await tx
      .update(portalHealthIntervals)
      .set({
        sourceVersion: command.health.sourceVersion,
        observedAt:
          command.health.observedAt < current.observedAt
            ? current.observedAt
            : command.health.observedAt,
      })
      .where(eq(portalHealthIntervals.id, current.id))
    return
  }
  const effectiveFrom =
    current && command.health.effectiveAt <= current.effectiveFrom
      ? new Date(current.effectiveFrom.getTime() + 1)
      : command.health.effectiveAt
  if (current) {
    await tx
      .update(portalHealthIntervals)
      .set({ effectiveTo: effectiveFrom })
      .where(eq(portalHealthIntervals.id, current.id))
  }
  await tx.insert(portalHealthIntervals).values({
    id: command.health.id,
    organizationId: unbrand(command.organizationId),
    propertyId: unbrand(command.propertyId),
    portalId: unbrand(command.portalId),
    status: command.health.value.status,
    reason: command.health.value.reason,
    sourceVersion: command.health.sourceVersion,
    effectiveFrom,
    effectiveTo: null,
    observedAt:
      command.health.observedAt < effectiveFrom
        ? effectiveFrom
        : command.health.observedAt,
  })
}

async function assertSnapshotMatchesCommittedWorkingCopy(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  command: UpdatePortalCommand &
    Readonly<{
      publication: Extract<
        NonNullable<UpdatePortalCommand['publication']>,
        Readonly<{ kind: 'publish' }>
      >
    }>,
): Promise<void> {
  const [portal] = await tx
    .select()
    .from(portals)
    .where(
      and(
        eq(portals.organizationId, unbrand(command.organizationId)),
        eq(portals.propertyId, unbrand(command.propertyId)),
        eq(portals.id, unbrand(command.portalId)),
        isNull(portals.deletedAt),
      ),
    )
    .limit(1)
  if (!portal) {
    throw portalError(
      'publication_snapshot_unavailable',
      'Portal disappeared while its publication snapshot was being committed',
    )
  }
  const organizationResult = await tx.execute(
    sql`SELECT name FROM "organization" WHERE id = ${unbrand(command.organizationId)} LIMIT 1 FOR SHARE`,
  )
  const categories = await tx
    .select()
    .from(portalLinkCategories)
    .where(
      and(
        eq(portalLinkCategories.organizationId, unbrand(command.organizationId)),
        eq(portalLinkCategories.portalId, unbrand(command.portalId)),
      ),
    )
    .orderBy(portalLinkCategories.sortKey, portalLinkCategories.id)
  const links = await tx
    .select({
      link: portalLinks,
      destinationUri: portalApprovedDestinations.normalizedUri,
      destinationApprovalState: portalApprovedDestinations.approvalState,
    })
    .from(portalLinks)
    .leftJoin(
      portalApprovedDestinations,
      and(
        eq(portalApprovedDestinations.organizationId, portalLinks.organizationId),
        eq(portalApprovedDestinations.propertyId, portalLinks.propertyId),
        eq(portalApprovedDestinations.id, portalLinks.destinationId),
      ),
    )
    .where(
      and(
        eq(portalLinks.organizationId, unbrand(command.organizationId)),
        eq(portalLinks.portalId, unbrand(command.portalId)),
      ),
    )
    .orderBy(portalLinks.sortKey, portalLinks.id)
  const organization = organizationResult.rows[0] as { name?: unknown } | undefined
  if (!organization || typeof organization.name !== 'string') {
    throw portalError(
      'publication_snapshot_unavailable',
      'Portal organization display content is unavailable',
    )
  }

  const approved = command.publication.snapshot.configuration
  const localized = approved.schemaVersion === 2
  const [brandProfile, brandContents, localizedOverrides] = localized
    ? await Promise.all([
        tx
          .select()
          .from(propertyPortalBrandProfiles)
          .where(
            and(
              eq(
                propertyPortalBrandProfiles.organizationId,
                unbrand(command.organizationId),
              ),
              eq(propertyPortalBrandProfiles.propertyId, unbrand(command.propertyId)),
            ),
          )
          .limit(1),
        tx
          .select()
          .from(propertyPortalBrandContents)
          .where(
            and(
              eq(
                propertyPortalBrandContents.organizationId,
                unbrand(command.organizationId),
              ),
              eq(propertyPortalBrandContents.propertyId, unbrand(command.propertyId)),
            ),
          ),
        tx
          .select()
          .from(portalLocalizedOverrides)
          .where(
            and(
              eq(
                portalLocalizedOverrides.organizationId,
                unbrand(command.organizationId),
              ),
              eq(portalLocalizedOverrides.propertyId, unbrand(command.propertyId)),
              eq(portalLocalizedOverrides.portalId, unbrand(command.portalId)),
            ),
          ),
      ])
    : [[], [], []]
  const brand = brandProfile[0]

  const committed = {
    portal: {
      id: portal.id,
      name: portal.name,
      slug: portal.slug,
      description: portal.description,
      heroImageUrl: portal.heroImageUrl,
      theme: portal.theme,
      organizationName: localized ? brand?.displayName : organization.name,
    },
    categories: categories.map((category) => ({
      id: category.id,
      title: category.title,
      sortKey: category.sortKey,
    })),
    links: links.flatMap(({ link, destinationUri, destinationApprovalState }) => {
      const url = localized
        ? destinationApprovalState === 'approved'
          ? destinationUri
          : null
        : link.url
      return url
        ? [
            {
              id: link.id,
              label: link.label,
              url,
              categoryId: link.categoryId,
              sortKey: link.sortKey,
            },
          ]
        : []
    }),
    privateFeedbackThreshold: portal.privateFeedbackThreshold,
  }
  const snapshotted = {
    portal: approved.portal,
    categories: approved.categories,
    links: approved.links,
    privateFeedbackThreshold: approved.reviewGateway.privateFeedbackThreshold,
  }
  if (canonicalizeRfc8785(committed) !== canonicalizeRfc8785(snapshotted)) {
    throw portalError(
      'revision_conflict',
      'Portal content changed while the publication snapshot was being committed',
    )
  }
  if (localized) {
    if (!brand) {
      throw portalError(
        'revision_conflict',
        'Property Brand Profile changed while the publication snapshot was committed',
      )
    }
    const contents = new Map(brandContents.map((item) => [item.locale, item]))
    const overrides = new Map(localizedOverrides.map((item) => [item.locale, item]))
    const localizedContent = Object.fromEntries(
      approved.localeSet.flatMap((locale) => {
        const content = contents.get(locale)
        if (!content) return []
        const override = overrides.get(locale)
        return [
          [
            locale,
            {
              title: override?.title ?? content.title,
              shortDescription: override?.shortDescription ?? content.shortDescription,
              heroImageUrl: override?.heroImageUrl ?? brand.defaultHeroImageUrl ?? null,
            },
          ],
        ]
      }),
    )
    const expectedExperience = {
      localeSet: [
        portal.primaryGuestLocale,
        ...((Array.isArray(portal.additionalGuestLocales)
          ? portal.additionalGuestLocales
          : []) as string[]),
      ].filter((locale, index, all) => all.indexOf(locale) === index),
      localizedContent,
      brandProfile: {
        displayName: brand.displayName,
        logoUrl: brand.logoUrl,
        defaultHeroImageUrl: brand.defaultHeroImageUrl,
        primaryColor: brand.primaryColor,
        backgroundColor: brand.backgroundColor,
        textColor: brand.textColor,
        version: brand.version,
      },
    }
    const approvedExperience = {
      localeSet: approved.localeSet,
      localizedContent: approved.localizedContent,
      brandProfile: approved.brandProfile,
    }
    if (
      canonicalizeRfc8785(expectedExperience) !== canonicalizeRfc8785(approvedExperience)
    ) {
      throw portalError(
        'revision_conflict',
        'Portal brand or localized content changed during publication',
      )
    }
  }
}

function snapshotToRow(
  snapshot: import('../domain/portal-publication-snapshot').PortalPublicationSnapshot,
) {
  const localized =
    snapshot.configuration.schemaVersion === 2 ? snapshot.configuration : null
  return {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    propertyId: snapshot.propertyId,
    portalId: snapshot.portalId,
    version: snapshot.version,
    configurationDigest: snapshot.configurationDigest,
    configuration: snapshot.configuration,
    guestLocale: snapshot.configuration.guestLocale,
    languagePackVersion: snapshot.configuration.languagePackVersion,
    localeSet: localized?.localeSet ?? ['en'],
    languagePackVersions: localized?.languagePackVersions ?? {
      en: 'guest-ui-en-v1',
    },
    localizedContent: localized?.localizedContent ?? {},
    brandProfileVersion: localized?.brandProfile.version ?? null,
    privateFeedbackThreshold:
      snapshot.configuration.reviewGateway.privateFeedbackThreshold,
    destinationUri: snapshot.destinationUri,
    destinationRetrievedAt: snapshot.destinationRetrievedAt,
    destinationSourceEpoch: snapshot.destinationSourceEpoch,
    destinationProfileVersion: snapshot.destinationProfileVersion,
    createdBy: snapshot.createdBy,
    createdAt: snapshot.createdAt,
  } satisfies typeof portalPublicationSnapshots.$inferInsert
}

function activationToRow(
  activation: import('../domain/portal-publication-snapshot').PortalPublicationActivation,
) {
  return {
    id: activation.id,
    organizationId: activation.organizationId,
    propertyId: activation.propertyId,
    portalId: activation.portalId,
    snapshotId: activation.snapshotId,
    activationSequence: activation.activationSequence,
    kind: activation.kind,
    activatedBy: activation.activatedBy,
    activatedAt: activation.activatedAt,
    deactivatedAt: activation.deactivatedAt,
    deactivationReason: activation.deactivationReason,
  } satisfies typeof portalPublicationActivations.$inferInsert
}

async function closeActivePublication(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  command: UpdatePortalCommand,
  reason: 'disabled' | 'archived' | 'replaced',
): Promise<number> {
  const closed = await tx
    .update(portalPublicationActivations)
    .set({
      deactivatedAt: command.occurredAt,
      deactivationReason: reason,
    })
    .where(
      and(
        eq(portalPublicationActivations.organizationId, unbrand(command.organizationId)),
        eq(portalPublicationActivations.propertyId, unbrand(command.propertyId)),
        eq(portalPublicationActivations.portalId, unbrand(command.portalId)),
        isNull(portalPublicationActivations.deactivatedAt),
      ),
    )
    .returning({ id: portalPublicationActivations.id })
  return closed.length
}

function assertDeleteCommand(command: DeletePortalCommand): void {
  const matches = (event: {
    organizationId: DeletePortalCommand['organizationId']
    propertyId: DeletePortalCommand['propertyId']
    portalId: DeletePortalCommand['portalId']
    occurredAt: Date
  }) =>
    event.organizationId === command.organizationId &&
    event.propertyId === command.propertyId &&
    event.portalId === command.portalId &&
    sameInstant(event.occurredAt, command.occurredAt)

  if (
    !matches(command.event) ||
    !matches(command.tokenRevokedEvent) ||
    command.event.sourceAggregateVersion !== command.revision.toISOString() ||
    command.tokenRevokedEvent.sourceAggregateVersion !== command.revision.toISOString() ||
    command.reason.trim().length === 0
  ) {
    throw portalError(
      'forbidden',
      'Tenant, resource, or version mismatch on Portal delete',
    )
  }
  if (command.revision.getTime() <= command.expectedUpdatedAt.getTime()) {
    throw portalError(
      'revision_conflict',
      'Portal command revision must advance monotonically',
    )
  }
}

function assertDeletePortalGroupCommand(command: DeletePortalGroupCommand): void {
  const { event } = command
  if (
    event.organizationId !== command.organizationId ||
    event.propertyId !== command.propertyId ||
    event.portalGroupId !== command.portalGroupId ||
    event.sourceAggregateVersion !== command.revision.toISOString() ||
    !sameInstant(event.occurredAt, command.occurredAt)
  ) {
    throw portalError('forbidden', 'Tenant or resource mismatch on Portal Group delete')
  }
  if (command.revision.getTime() <= command.expectedUpdatedAt.getTime()) {
    throw portalError(
      'revision_conflict',
      'Portal Group command revision must advance monotonically',
    )
  }
}

function assertCreatePortalGroupCommand(command: CreatePortalGroupCommand): void {
  const [created, ...membershipEvents] = command.events
  if (
    command.group.organizationId !== command.organizationId ||
    created._tag !== 'portal_group.created' ||
    created.organizationId !== command.organizationId ||
    created.propertyId !== command.group.propertyId ||
    created.portalGroupId !== command.group.id ||
    created.sourceAggregateVersion !== command.group.updatedAt.toISOString() ||
    !sameInstant(created.occurredAt, command.group.createdAt) ||
    membershipEvents.length !== command.memberships.length ||
    membershipEvents.some((event, index) => {
      const membership = command.memberships[index]
      return (
        !membership ||
        event._tag !== 'portal_group.portal_added' ||
        event.organizationId !== command.organizationId ||
        event.propertyId !== command.group.propertyId ||
        event.portalGroupId !== command.group.id ||
        event.portalId !== membership.portalId ||
        event.sourceAggregateVersion !== command.group.updatedAt.toISOString() ||
        !sameInstant(event.occurredAt, command.group.createdAt)
      )
    })
  ) {
    throw portalError(
      'forbidden',
      'Tenant, resource, or fact mismatch on Portal Group creation',
    )
  }
}

function assertUpdatePortalGroupCommand(command: UpdatePortalGroupCommand): void {
  if (
    command.event.organizationId !== command.organizationId ||
    command.event.propertyId !== command.propertyId ||
    command.event.portalGroupId !== command.portalGroupId ||
    command.event.name !== command.name ||
    command.event.sourceAggregateVersion !== command.revision.toISOString() ||
    !sameInstant(command.event.occurredAt, command.occurredAt)
  ) {
    throw portalError('forbidden', 'Tenant or resource mismatch on Portal Group update')
  }
}

function assertMembershipCommand(
  command: AddPortalToGroupCommand | RemovePortalFromGroupCommand,
  expectedTag: 'portal_group.portal_added' | 'portal_group.portal_removed',
): void {
  if (
    command.event._tag !== expectedTag ||
    command.event.organizationId !== command.organizationId ||
    command.event.propertyId !== command.propertyId ||
    command.event.portalGroupId !== command.portalGroupId ||
    command.event.portalId !== command.portalId ||
    command.event.sourceAggregateVersion !== command.revision.toISOString() ||
    !sameInstant(command.event.occurredAt, command.occurredAt)
  ) {
    throw portalError(
      'forbidden',
      'Tenant or resource mismatch on Portal Group membership change',
    )
  }
}

async function fencePortalGroup(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  command: Readonly<{
    organizationId: CreatePortalGroupCommand['organizationId']
    propertyId: CreatePortalGroupCommand['group']['propertyId']
    portalGroupId: CreatePortalGroupCommand['group']['id']
    expectedUpdatedAt: Date
    revision: Date
    occurredAt: Date
  }>,
  patch: Readonly<{ name?: string }> = {},
): Promise<void> {
  if (command.revision.getTime() <= command.expectedUpdatedAt.getTime()) {
    throw portalError(
      'revision_conflict',
      'Portal Group command revision must advance monotonically',
    )
  }
  const [updated] = await tx
    .update(portalGroups)
    .set({ ...patch, updatedAt: command.revision })
    .where(
      and(
        eq(portalGroups.organizationId, unbrand(command.organizationId)),
        eq(portalGroups.propertyId, unbrand(command.propertyId)),
        eq(portalGroups.id, unbrand(command.portalGroupId)),
        eq(portalGroups.updatedAt, command.expectedUpdatedAt),
        isNull(portalGroups.deletedAt),
      ),
    )
    .returning({ updatedAt: portalGroups.updatedAt })
  assertCommittedRevision(
    updated,
    command.revision,
    'Portal Group',
    'Portal Group changed while the command was being committed',
  )
}

type PortalContentCommand =
  | CreatePortalLinkCategoryCommand
  | UpdatePortalLinkCategoryCommand
  | DeletePortalLinkCategoryCommand
  | ReorderPortalLinkCategoriesCommand
  | CreatePortalLinkCommand
  | UpdatePortalLinkCommand
  | DeletePortalLinkCommand
  | ReorderPortalLinksCommand

type PortalAggregateFence = Readonly<{
  organizationId: IssuePortalTokenCommand['organizationId']
  propertyId: IssuePortalTokenCommand['propertyId']
  portalId: IssuePortalTokenCommand['portalId']
  expectedPortalUpdatedAt: Date
  revision: Date
  occurredAt: Date
}>

function assertPortalContentCommand(command: PortalContentCommand): void {
  const event = command.event
  let scoped = false
  switch (event._tag) {
    case 'portal_link_category.created':
      scoped =
        'category' in command &&
        command.category.organizationId === command.organizationId &&
        command.category.portalId === command.portalId &&
        event.categoryId === command.category.id
      break
    case 'portal_link_category.updated':
      scoped = 'title' in command && event.categoryId === command.categoryId
      break
    case 'portal_link_category.deleted':
      scoped =
        'categoryId' in command &&
        !('linkId' in command) &&
        event.categoryId === command.categoryId
      break
    case 'portal_link_category.reordered':
      scoped = 'updates' in command && !('categoryId' in command)
      break
    case 'portal_link.created':
      scoped =
        'link' in command &&
        command.link.organizationId === command.organizationId &&
        command.link.portalId === command.portalId &&
        event.linkId === command.link.id &&
        event.categoryId === command.link.categoryId
      break
    case 'portal_link.updated':
    case 'portal_link.deleted':
      scoped =
        'linkId' in command &&
        event.linkId === command.linkId &&
        event.categoryId === command.categoryId
      break
    case 'portal_link.reordered':
      scoped =
        'updates' in command &&
        'categoryId' in command &&
        event.categoryId === command.categoryId
      break
  }
  if (
    event.organizationId !== command.organizationId ||
    event.propertyId !== command.propertyId ||
    event.portalId !== command.portalId ||
    event.sourceAggregateVersion !== command.revision.toISOString() ||
    !sameInstant(event.occurredAt, command.occurredAt) ||
    !scoped
  ) {
    throw portalError('forbidden', 'Tenant or resource mismatch on Portal content change')
  }
}

async function fencePortalContent(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  command: PortalAggregateFence,
): Promise<void> {
  if (command.revision.getTime() <= command.expectedPortalUpdatedAt.getTime()) {
    throw portalError(
      'revision_conflict',
      'Portal command revision must advance monotonically',
    )
  }
  const [updated] = await tx
    .update(portals)
    .set({ updatedAt: command.revision })
    .where(
      and(
        eq(portals.organizationId, unbrand(command.organizationId)),
        eq(portals.propertyId, unbrand(command.propertyId)),
        eq(portals.id, unbrand(command.portalId)),
        eq(portals.updatedAt, command.expectedPortalUpdatedAt),
        isNull(portals.deletedAt),
      ),
    )
    .returning({ updatedAt: portals.updatedAt })
  assertCommittedRevision(
    updated,
    command.revision,
    'Portal',
    'Portal content changed while the command was being committed',
  )
}

function portalTokenToRow(
  token: import('../domain/portal-token').PortalToken,
): typeof portalTokens.$inferInsert {
  return {
    id: token.id,
    organizationId: token.organizationId,
    propertyId: token.propertyId,
    portalId: token.portalId,
    tokenIdentifier: token.tokenIdentifier,
    tokenHash: token.tokenHash,
    tokenKeyVersion: token.tokenKeyVersion,
    version: token.version,
    printBatch: token.printBatch,
    status: token.status,
    issuedAt: token.issuedAt,
    gracePeriodEnds: token.gracePeriodEnds,
    retiredAt: token.retiredAt,
    revokedAt: token.revokedAt,
    revokedBy: token.revokedBy,
    revokedReason: token.revokedReason,
  }
}

function accessArtifactToRow(
  artifact: import('../domain/portal-access-artifact').PortalAccessArtifact,
): typeof portalAccessArtifacts.$inferInsert {
  return {
    id: artifact.id,
    organizationId: artifact.organizationId,
    propertyId: artifact.propertyId,
    portalId: artifact.portalId,
    portalTokenId: artifact.portalTokenId,
    channel: artifact.channel,
    status: artifact.status,
    publishedAt: artifact.publishedAt,
    retiredAt: artifact.retiredAt,
  }
}

function accessArtifactSetMatches(
  command: Readonly<{
    organizationId: IssuePortalTokenCommand['organizationId']
    propertyId: IssuePortalTokenCommand['propertyId']
    portalId: IssuePortalTokenCommand['portalId']
    revision: Date
    occurredAt: Date
    accessArtifacts: IssuePortalTokenCommand['accessArtifacts']
    accessArtifactEvents: IssuePortalTokenCommand['accessArtifactEvents']
  }>,
  portalTokenId: string,
): boolean {
  if (
    command.accessArtifacts[0].channel !== 'qr' ||
    command.accessArtifacts[1].channel !== 'nfc'
  ) {
    return false
  }
  return command.accessArtifacts.every((artifact, index) => {
    const event = command.accessArtifactEvents[index]
    return (
      event !== undefined &&
      artifact.organizationId === command.organizationId &&
      artifact.propertyId === command.propertyId &&
      artifact.portalId === command.portalId &&
      artifact.portalTokenId === portalTokenId &&
      artifact.status === 'published' &&
      artifact.retiredAt === null &&
      sameInstant(artifact.publishedAt, command.occurredAt) &&
      event.accessArtifactId === artifact.id &&
      event.organizationId === command.organizationId &&
      event.propertyId === command.propertyId &&
      event.portalId === command.portalId &&
      event.channel === artifact.channel &&
      event.sourceAggregateVersion === command.revision.toISOString() &&
      sameInstant(event.occurredAt, command.occurredAt)
    )
  })
}

function assertIssueTokenCommand(command: IssuePortalTokenCommand): void {
  if (
    command.token.organizationId !== unbrand(command.organizationId) ||
    command.token.propertyId !== unbrand(command.propertyId) ||
    command.token.portalId !== unbrand(command.portalId) ||
    command.token.status !== 'active' ||
    !accessArtifactSetMatches(command, command.token.id) ||
    command.event.organizationId !== command.organizationId ||
    command.event.propertyId !== command.propertyId ||
    command.event.portalId !== command.portalId ||
    command.event.tokenIdentifier !== command.token.tokenIdentifier ||
    command.event.version !== command.token.version ||
    command.event.sourceAggregateVersion !== command.revision.toISOString() ||
    !sameInstant(command.event.occurredAt, command.occurredAt) ||
    !sameInstant(command.token.issuedAt, command.occurredAt)
  ) {
    throw portalError('forbidden', 'Tenant or resource mismatch on Portal token issue')
  }
}

function assertRotateTokenCommand(command: RotatePortalTokenCommand): void {
  const oldToken = command.oldToken
  const newToken = command.newToken
  if (
    oldToken.organizationId !== unbrand(command.organizationId) ||
    oldToken.propertyId !== unbrand(command.propertyId) ||
    oldToken.portalId !== unbrand(command.portalId) ||
    oldToken.status !== 'rotating' ||
    !oldToken.gracePeriodEnds ||
    newToken.organizationId !== oldToken.organizationId ||
    newToken.propertyId !== oldToken.propertyId ||
    newToken.portalId !== oldToken.portalId ||
    newToken.status !== 'active' ||
    newToken.version !== oldToken.version + 1 ||
    !accessArtifactSetMatches(command, newToken.id) ||
    command.event.organizationId !== command.organizationId ||
    command.event.propertyId !== command.propertyId ||
    command.event.portalId !== command.portalId ||
    command.event.previousVersion !== oldToken.version ||
    command.event.version !== newToken.version ||
    command.event.sourceAggregateVersion !== command.revision.toISOString() ||
    !sameInstant(command.event.gracePeriodEnds, oldToken.gracePeriodEnds) ||
    !sameInstant(command.event.occurredAt, command.occurredAt) ||
    !sameInstant(newToken.issuedAt, command.occurredAt)
  ) {
    throw portalError('forbidden', 'Tenant or resource mismatch on Portal token rotate')
  }
}

function assertRevokeTokenCommand(command: RevokePortalTokensCommand): void {
  if (
    command.reason.trim().length === 0 ||
    command.event.organizationId !== command.organizationId ||
    command.event.propertyId !== command.propertyId ||
    command.event.portalId !== command.portalId ||
    command.event.sourceAggregateVersion !== command.revision.toISOString() ||
    !sameInstant(command.event.occurredAt, command.occurredAt)
  ) {
    throw portalError('forbidden', 'Tenant or resource mismatch on Portal token revoke')
  }
}

export const createAtomicPortalCommandStore = (db: Database): PortalCommandStore => {
  return {
    createPortal: async (command) =>
      trace('portal.commandStore.createPortal', async () => {
        assertCreateCommand(command)
        await db.transaction(async (tx) => {
          const [created] = await tx
            .insert(portals)
            .values(portalToRow(command.portal))
            .returning({ updatedAt: portals.updatedAt })
          assertCommittedRevision(
            created,
            command.portal.updatedAt,
            'Portal',
            'Portal creation did not return its command revision',
          )
          if (command.initialResponsibleManagerId) {
            await tx.insert(portalResponsibleManagers).values({
              organizationId: command.organizationId,
              propertyId: command.portal.propertyId,
              portalId: command.portal.id,
              userId: command.initialResponsibleManagerId,
              effectiveFrom: command.portal.createdAt,
              createdBy: command.initialResponsibleManagerId,
            })
          }
          if (command.health) {
            await tx.insert(portalHealthIntervals).values({
              id: command.health.id,
              organizationId: unbrand(command.organizationId),
              propertyId: unbrand(command.portal.propertyId),
              portalId: unbrand(command.portal.id),
              status: command.health.value.status,
              reason: command.health.value.reason,
              sourceVersion: command.health.sourceVersion,
              effectiveFrom: command.health.effectiveAt,
              effectiveTo: null,
              observedAt: command.health.observedAt,
            })
          }
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.portal.createdAt,
          })
          if (command.responsibilityNeededEvent) {
            await insertOutboxRow(tx, command.responsibilityNeededEvent, {
              recordedAt: command.portal.createdAt,
            })
          }
        })
      }),

    updatePortal: async (command) =>
      trace('portal.commandStore.updatePortal', async () => {
        assertUpdateCommand(command)
        await db.transaction(async (tx) => {
          if (command.publication?.kind === 'publish') {
            await lockPortalPublicationProperty(
              tx,
              unbrand(command.organizationId),
              unbrand(command.propertyId),
            )
          }
          const [updated] = await tx
            .update(portals)
            .set({ ...buildPortalSetClause(command.patch), updatedAt: command.revision })
            .where(
              and(
                eq(portals.organizationId, unbrand(command.organizationId)),
                eq(portals.propertyId, unbrand(command.propertyId)),
                eq(portals.id, unbrand(command.portalId)),
                eq(portals.publicationState, command.event.previousPublicationState),
                eq(portals.updatedAt, command.expectedUpdatedAt),
                isNull(portals.deletedAt),
              ),
            )
            .returning({ updatedAt: portals.updatedAt })
          assertCommittedRevision(
            updated,
            command.revision,
            'Portal',
            'Portal changed while the update was being committed',
          )

          if (command.publication?.kind === 'publish') {
            // Every content path locks the Portal aggregate first. Taking the
            // bounded working-copy table locks second preserves that universal
            // order while still preventing child writers from crossing the
            // committed snapshot comparison below.
            await tx.execute(
              sql`LOCK TABLE ${portalLinkCategories}, ${portalLinks} IN SHARE ROW EXCLUSIVE MODE`,
            )
            await assertSnapshotMatchesCommittedWorkingCopy(
              tx,
              command as UpdatePortalCommand & {
                publication: Extract<
                  NonNullable<UpdatePortalCommand['publication']>,
                  { kind: 'publish' }
                >
              },
            )
            const unexpectedlyActive = await closeActivePublication(
              tx,
              command,
              'replaced',
            )
            if (unexpectedlyActive !== 0) {
              throw portalError(
                'revision_conflict',
                'A non-published Portal unexpectedly retained an active publication',
              )
            }
            await tx
              .insert(portalPublicationSnapshots)
              .values(snapshotToRow(command.publication.snapshot))
            await tx
              .insert(portalPublicationActivations)
              .values(activationToRow(command.publication.activation))
            await resolvePortalPendingContentChanges(tx, {
              organizationId: unbrand(command.organizationId),
              propertyId: unbrand(command.propertyId),
              portalId: unbrand(command.portalId),
              snapshotId: command.publication.snapshot.id,
              resolvedAt: command.occurredAt,
            })
          } else if (command.publication?.kind === 'rollback') {
            const [target] = await tx
              .select({
                id: portalPublicationSnapshots.id,
                configurationDigest: portalPublicationSnapshots.configurationDigest,
              })
              .from(portalPublicationSnapshots)
              .where(
                and(
                  eq(
                    portalPublicationSnapshots.organizationId,
                    unbrand(command.organizationId),
                  ),
                  eq(portalPublicationSnapshots.propertyId, unbrand(command.propertyId)),
                  eq(portalPublicationSnapshots.portalId, unbrand(command.portalId)),
                  eq(portalPublicationSnapshots.id, command.publication.snapshotId),
                  eq(
                    portalPublicationSnapshots.version,
                    command.publication.snapshotVersion,
                  ),
                ),
              )
              .limit(1)
            if (!target) {
              throw portalError(
                'publication_snapshot_unavailable',
                'The requested rollback snapshot does not belong to this Portal',
              )
            }
            if (target.configurationDigest !== command.publication.publicationDigest) {
              throw portalError(
                'publication_snapshot_unavailable',
                'The rollback publication digest does not match its immutable snapshot',
              )
            }
            const closed = await closeActivePublication(tx, command, 'replaced')
            if (closed !== 1) {
              throw portalError(
                'revision_conflict',
                'Rollback requires exactly one active Portal publication',
              )
            }
            await tx
              .insert(portalPublicationActivations)
              .values(activationToRow(command.publication.activation))
          } else if (command.publication?.kind === 'deactivate') {
            // Legacy published rows can have no activation during the expand
            // migration. They must still be safely disable-able. More than one
            // is impossible under the partial unique index.
            await closeActivePublication(tx, command, command.publication.reason)
          }
          if (command.health) {
            await applyPortalHealthMutation(
              tx,
              command as UpdatePortalCommand & {
                health: NonNullable<UpdatePortalCommand['health']>
              },
            )
          }
          if (
            command.publication?.kind !== 'publish' &&
            hasPortalWorkingCopyPatch(command.patch)
          ) {
            await recordPortalPendingContentChange(tx, {
              organizationId: unbrand(command.organizationId),
              propertyId: unbrand(command.propertyId),
              portalId: unbrand(command.portalId),
              kind: 'portal_configuration',
              sourceVersion: command.revision.toISOString(),
              changedAt: command.occurredAt,
            })
          }
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.event.occurredAt,
          })
          if (command.lifecycleEvent) {
            await insertOutboxRow(tx, command.lifecycleEvent, {
              recordedAt: command.lifecycleEvent.occurredAt,
            })
          }
          if (command.localeSetEvent) {
            await insertOutboxRow(tx, command.localeSetEvent, {
              recordedAt: command.localeSetEvent.occurredAt,
            })
          }
        })
      }),

    deletePortal: async (command) =>
      trace('portal.commandStore.deletePortal', async () => {
        assertDeleteCommand(command)
        const revoked = await db.transaction(async (tx) => {
          const [deleted] = await tx
            .update(portals)
            .set({ deletedAt: command.occurredAt, updatedAt: command.revision })
            .where(
              and(
                eq(portals.organizationId, unbrand(command.organizationId)),
                eq(portals.propertyId, unbrand(command.propertyId)),
                eq(portals.id, unbrand(command.portalId)),
                eq(portals.updatedAt, command.expectedUpdatedAt),
                isNull(portals.deletedAt),
              ),
            )
            .returning({ updatedAt: portals.updatedAt })
          assertCommittedRevision(
            deleted,
            command.revision,
            'Portal',
            'Portal changed while the delete was being committed',
          )

          const revokedRows = await tx
            .update(portalTokens)
            .set({
              status: 'revoked',
              revokedAt: command.occurredAt,
              retiredAt: command.occurredAt,
              revokedBy: unbrand(command.revokedBy),
              revokedReason: command.reason.trim(),
              gracePeriodEnds: null,
            })
            .where(
              and(
                eq(portalTokens.organizationId, unbrand(command.organizationId)),
                eq(portalTokens.propertyId, unbrand(command.propertyId)),
                eq(portalTokens.portalId, unbrand(command.portalId)),
                or(
                  eq(portalTokens.status, 'active'),
                  eq(portalTokens.status, 'rotating'),
                ),
              ),
            )
            .returning({ id: portalTokens.id })

          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
          if (revokedRows.length > 0) {
            await insertOutboxRow(tx, command.tokenRevokedEvent, {
              recordedAt: command.occurredAt,
            })
          }
          return revokedRows.length
        })

        return { revoked }
      }),

    createPortalGroup: async (command) =>
      trace('portal.commandStore.createPortalGroup', async () => {
        assertCreatePortalGroupCommand(command)
        await db.transaction(async (tx) => {
          const [created] = await tx
            .insert(portalGroups)
            .values(portalGroupToRow(command.group))
            .returning({ updatedAt: portalGroups.updatedAt })
          assertCommittedRevision(
            created,
            command.group.updatedAt,
            'Portal Group',
            'Portal Group creation did not return its command revision',
          )
          for (const membership of command.memberships) {
            await tx.execute(sql`
              SELECT id FROM portals
              WHERE organization_id = ${unbrand(command.organizationId)}
                AND property_id = ${unbrand(command.group.propertyId)}
                AND id = ${unbrand(membership.portalId)}
                AND deleted_at IS NULL
              FOR UPDATE
            `)
            const [portal] = await tx
              .select({ id: portals.id })
              .from(portals)
              .where(
                and(
                  eq(portals.organizationId, unbrand(command.organizationId)),
                  eq(portals.propertyId, unbrand(command.group.propertyId)),
                  eq(portals.id, unbrand(membership.portalId)),
                  isNull(portals.deletedAt),
                ),
              )
              .limit(1)
            if (!portal) {
              throw portalError(
                'forbidden',
                'Initial Portal Group membership requires an active same-property Portal',
              )
            }
            await tx.insert(portalGroupMemberships).values({
              organizationId: unbrand(command.organizationId),
              propertyId: unbrand(command.group.propertyId),
              portalId: unbrand(membership.portalId),
              portalGroupId: unbrand(command.group.id),
              effectiveFrom: command.group.createdAt,
              createdBy: unbrand(membership.createdBy),
            })
          }
          for (const event of command.events) {
            await insertOutboxRow(tx, event, { recordedAt: command.group.createdAt })
          }
        })
      }),

    updatePortalGroup: async (command) =>
      trace('portal.commandStore.updatePortalGroup', async () => {
        assertUpdatePortalGroupCommand(command)
        await db.transaction(async (tx) => {
          await fencePortalGroup(tx, command, { name: command.name })
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
        })
      }),

    addPortalToGroup: async (command) =>
      trace('portal.commandStore.addPortalToGroup', async () => {
        assertMembershipCommand(command, 'portal_group.portal_added')
        await db.transaction(async (tx) => {
          await fencePortalGroup(tx, command)
          await tx.execute(sql`
            SELECT id FROM portals
            WHERE organization_id = ${unbrand(command.organizationId)}
              AND property_id = ${unbrand(command.propertyId)}
              AND id = ${unbrand(command.portalId)}
              AND deleted_at IS NULL
            FOR UPDATE
          `)
          const [portal] = await tx
            .select({ id: portals.id })
            .from(portals)
            .where(
              and(
                eq(portals.organizationId, unbrand(command.organizationId)),
                eq(portals.propertyId, unbrand(command.propertyId)),
                eq(portals.id, unbrand(command.portalId)),
                isNull(portals.deletedAt),
              ),
            )
            .limit(1)
          if (!portal) {
            throw portalError(
              'forbidden',
              'Portal Group membership requires an active same-property Portal',
            )
          }
          await tx.execute(sql`
            SELECT id FROM portal_group_memberships
            WHERE organization_id = ${unbrand(command.organizationId)}
              AND portal_id = ${unbrand(command.portalId)}
              AND effective_to IS NULL
            FOR UPDATE
          `)
          const [existing] = await tx
            .select({ id: portalGroupMemberships.id })
            .from(portalGroupMemberships)
            .where(
              and(
                eq(
                  portalGroupMemberships.organizationId,
                  unbrand(command.organizationId),
                ),
                eq(portalGroupMemberships.portalId, unbrand(command.portalId)),
                isNull(portalGroupMemberships.effectiveTo),
              ),
            )
            .limit(1)
          if (existing) {
            throw portalError('portal_already_grouped', 'portal is already in a group')
          }
          await tx.insert(portalGroupMemberships).values({
            organizationId: unbrand(command.organizationId),
            propertyId: unbrand(command.propertyId),
            portalId: unbrand(command.portalId),
            portalGroupId: unbrand(command.portalGroupId),
            effectiveFrom: command.occurredAt,
            createdBy: unbrand(command.changedBy),
          })
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
        })
      }),

    removePortalFromGroup: async (command) =>
      trace('portal.commandStore.removePortalFromGroup', async () => {
        assertMembershipCommand(command, 'portal_group.portal_removed')
        await db.transaction(async (tx) => {
          await fencePortalGroup(tx, command)
          await tx.execute(sql`
            SELECT id FROM portal_group_memberships
            WHERE organization_id = ${unbrand(command.organizationId)}
              AND property_id = ${unbrand(command.propertyId)}
              AND portal_group_id = ${unbrand(command.portalGroupId)}
              AND portal_id = ${unbrand(command.portalId)}
              AND effective_to IS NULL
            FOR UPDATE
          `)
          const [active] = await tx
            .select()
            .from(portalGroupMemberships)
            .where(
              and(
                eq(
                  portalGroupMemberships.organizationId,
                  unbrand(command.organizationId),
                ),
                eq(portalGroupMemberships.propertyId, unbrand(command.propertyId)),
                eq(portalGroupMemberships.portalGroupId, unbrand(command.portalGroupId)),
                eq(portalGroupMemberships.portalId, unbrand(command.portalId)),
                isNull(portalGroupMemberships.effectiveTo),
              ),
            )
            .limit(1)
          if (!active) {
            throw portalError(
              'portal_not_in_group',
              'portal is not a member of this group',
            )
          }
          if (active.effectiveFrom >= command.occurredAt) {
            await tx
              .delete(portalGroupMemberships)
              .where(eq(portalGroupMemberships.id, active.id))
          } else {
            await tx
              .update(portalGroupMemberships)
              .set({
                effectiveTo: command.occurredAt,
                endReason: 'removed_from_group',
              })
              .where(eq(portalGroupMemberships.id, active.id))
          }
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
        })
      }),

    createPortalLinkCategory: async (command) =>
      trace('portal.commandStore.createPortalLinkCategory', async () => {
        assertPortalContentCommand(command)
        await db.transaction(async (tx) => {
          await fencePortalContent(tx, command)
          await tx.insert(portalLinkCategories).values(categoryToRow(command.category))
          await recordPortalContentCommandPending(tx, command)
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
        })
      }),

    updatePortalLinkCategory: async (command) =>
      trace('portal.commandStore.updatePortalLinkCategory', async () => {
        assertPortalContentCommand(command)
        await db.transaction(async (tx) => {
          await fencePortalContent(tx, command)
          const [updated] = await tx
            .update(portalLinkCategories)
            .set({ title: command.title, updatedAt: command.occurredAt })
            .where(
              and(
                eq(portalLinkCategories.organizationId, unbrand(command.organizationId)),
                eq(portalLinkCategories.portalId, unbrand(command.portalId)),
                eq(portalLinkCategories.id, unbrand(command.categoryId)),
              ),
            )
            .returning({ id: portalLinkCategories.id })
          if (!updated) {
            throw portalError(
              'revision_conflict',
              'Portal category changed during update',
            )
          }
          await recordPortalContentCommandPending(tx, command)
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
        })
      }),

    deletePortalLinkCategory: async (command) =>
      trace('portal.commandStore.deletePortalLinkCategory', async () => {
        assertPortalContentCommand(command)
        await db.transaction(async (tx) => {
          await fencePortalContent(tx, command)
          const [deleted] = await tx
            .delete(portalLinkCategories)
            .where(
              and(
                eq(portalLinkCategories.organizationId, unbrand(command.organizationId)),
                eq(portalLinkCategories.portalId, unbrand(command.portalId)),
                eq(portalLinkCategories.id, unbrand(command.categoryId)),
              ),
            )
            .returning({ id: portalLinkCategories.id })
          if (!deleted) {
            throw portalError(
              'revision_conflict',
              'Portal category changed during delete',
            )
          }
          await recordPortalContentCommandPending(tx, command)
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
        })
      }),

    reorderPortalLinkCategories: async (command) =>
      trace('portal.commandStore.reorderPortalLinkCategories', async () => {
        assertPortalContentCommand(command)
        await db.transaction(async (tx) => {
          await fencePortalContent(tx, command)
          const ids = command.updates.map(({ id }) => unbrand(id))
          if (ids.length > 0) {
            const scoped = await tx
              .select({ id: portalLinkCategories.id })
              .from(portalLinkCategories)
              .where(
                and(
                  eq(
                    portalLinkCategories.organizationId,
                    unbrand(command.organizationId),
                  ),
                  eq(portalLinkCategories.portalId, unbrand(command.portalId)),
                  inArray(portalLinkCategories.id, ids),
                ),
              )
            if (scoped.length !== ids.length) {
              throw portalError('forbidden', 'Portal category scope mismatch')
            }
          }
          for (const update of command.updates) {
            await tx
              .update(portalLinkCategories)
              .set({ sortKey: update.sortKey, updatedAt: command.occurredAt })
              .where(
                and(
                  eq(
                    portalLinkCategories.organizationId,
                    unbrand(command.organizationId),
                  ),
                  eq(portalLinkCategories.portalId, unbrand(command.portalId)),
                  eq(portalLinkCategories.id, unbrand(update.id)),
                ),
              )
          }
          await recordPortalContentCommandPending(tx, command)
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
        })
      }),

    createPortalLink: async (command) =>
      trace('portal.commandStore.createPortalLink', async () => {
        assertPortalContentCommand(command)
        await db.transaction(async (tx) => {
          await fencePortalContent(tx, command)
          await tx.insert(portalLinks).values(linkToRow(command.link))
          await recordPortalContentCommandPending(tx, command)
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
        })
      }),

    updatePortalLink: async (command) =>
      trace('portal.commandStore.updatePortalLink', async () => {
        assertPortalContentCommand(command)
        await db.transaction(async (tx) => {
          await fencePortalContent(tx, command)
          const [updated] = await tx
            .update(portalLinks)
            .set({
              label: command.patch.label,
              destinationId: command.patch.destinationId
                ? unbrand(command.patch.destinationId)
                : null,
              url: command.patch.destinationId ? null : command.patch.url,
              legacyDestinationState: command.patch.legacyDestinationState,
              iconKey: command.patch.iconKey,
              updatedAt: command.occurredAt,
            })
            .where(
              and(
                eq(portalLinks.organizationId, unbrand(command.organizationId)),
                eq(portalLinks.portalId, unbrand(command.portalId)),
                eq(portalLinks.categoryId, unbrand(command.categoryId)),
                eq(portalLinks.id, unbrand(command.linkId)),
              ),
            )
            .returning({ id: portalLinks.id })
          if (!updated) {
            throw portalError('revision_conflict', 'Portal link changed during update')
          }
          await recordPortalContentCommandPending(tx, command)
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
        })
      }),

    deletePortalLink: async (command) =>
      trace('portal.commandStore.deletePortalLink', async () => {
        assertPortalContentCommand(command)
        await db.transaction(async (tx) => {
          await fencePortalContent(tx, command)
          const [deleted] = await tx
            .delete(portalLinks)
            .where(
              and(
                eq(portalLinks.organizationId, unbrand(command.organizationId)),
                eq(portalLinks.portalId, unbrand(command.portalId)),
                eq(portalLinks.categoryId, unbrand(command.categoryId)),
                eq(portalLinks.id, unbrand(command.linkId)),
              ),
            )
            .returning({ id: portalLinks.id })
          if (!deleted) {
            throw portalError('revision_conflict', 'Portal link changed during delete')
          }
          await recordPortalContentCommandPending(tx, command)
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
        })
      }),

    reorderPortalLinks: async (command) =>
      trace('portal.commandStore.reorderPortalLinks', async () => {
        assertPortalContentCommand(command)
        await db.transaction(async (tx) => {
          await fencePortalContent(tx, command)
          const ids = command.updates.map(({ id }) => unbrand(id))
          if (ids.length > 0) {
            const scoped = await tx
              .select({ id: portalLinks.id })
              .from(portalLinks)
              .where(
                and(
                  eq(portalLinks.organizationId, unbrand(command.organizationId)),
                  eq(portalLinks.portalId, unbrand(command.portalId)),
                  eq(portalLinks.categoryId, unbrand(command.categoryId)),
                  inArray(portalLinks.id, ids),
                ),
              )
            if (scoped.length !== ids.length) {
              throw portalError('forbidden', 'Portal link scope mismatch')
            }
          }
          for (const update of command.updates) {
            await tx
              .update(portalLinks)
              .set({ sortKey: update.sortKey, updatedAt: command.occurredAt })
              .where(
                and(
                  eq(portalLinks.organizationId, unbrand(command.organizationId)),
                  eq(portalLinks.portalId, unbrand(command.portalId)),
                  eq(portalLinks.categoryId, unbrand(command.categoryId)),
                  eq(portalLinks.id, unbrand(update.id)),
                ),
              )
          }
          await recordPortalContentCommandPending(tx, command)
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
        })
      }),

    issuePortalToken: async (command) =>
      trace('portal.commandStore.issuePortalToken', async () => {
        assertIssueTokenCommand(command)
        await db.transaction(async (tx) => {
          await fencePortalContent(tx, command)
          await tx.execute(sql`
            SELECT id FROM portal_tokens
            WHERE organization_id = ${unbrand(command.organizationId)}
              AND portal_id = ${unbrand(command.portalId)}
            FOR UPDATE
          `)
          const [latest] = await tx
            .select({ version: portalTokens.version, status: portalTokens.status })
            .from(portalTokens)
            .where(
              and(
                eq(portalTokens.organizationId, unbrand(command.organizationId)),
                eq(portalTokens.propertyId, unbrand(command.propertyId)),
                eq(portalTokens.portalId, unbrand(command.portalId)),
              ),
            )
            .orderBy(desc(portalTokens.version))
            .limit(1)
          if (latest && latest.status !== 'revoked') {
            throw portalError(
              'token_unavailable',
              'Rotate the active portal token instead',
            )
          }
          if (command.token.version !== (latest?.version ?? 0) + 1) {
            throw portalError(
              'revision_conflict',
              'Portal token version changed during issue',
            )
          }
          await tx.insert(portalTokens).values(portalTokenToRow(command.token))
          await tx
            .insert(portalAccessArtifacts)
            .values(command.accessArtifacts.map(accessArtifactToRow))
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
          for (const event of command.accessArtifactEvents) {
            await insertOutboxRow(tx, event, { recordedAt: command.occurredAt })
          }
        })
      }),

    rotatePortalToken: async (command) =>
      trace('portal.commandStore.rotatePortalToken', async () => {
        assertRotateTokenCommand(command)
        await db.transaction(async (tx) => {
          await fencePortalContent(tx, command)
          const [rotated] = await tx
            .update(portalTokens)
            .set({
              status: command.oldToken.status,
              gracePeriodEnds: command.oldToken.gracePeriodEnds,
              retiredAt: command.oldToken.retiredAt,
            })
            .where(
              and(
                eq(portalTokens.id, command.oldToken.id),
                eq(portalTokens.organizationId, unbrand(command.organizationId)),
                eq(portalTokens.propertyId, unbrand(command.propertyId)),
                eq(portalTokens.portalId, unbrand(command.portalId)),
                eq(portalTokens.version, command.oldToken.version),
                eq(portalTokens.status, 'active'),
              ),
            )
            .returning({ id: portalTokens.id })
          if (!rotated) {
            throw portalError('revision_conflict', 'Portal token changed during rotation')
          }
          await tx.insert(portalTokens).values(portalTokenToRow(command.newToken))
          await tx
            .insert(portalAccessArtifacts)
            .values(command.accessArtifacts.map(accessArtifactToRow))
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
          for (const event of command.accessArtifactEvents) {
            await insertOutboxRow(tx, event, { recordedAt: command.occurredAt })
          }
        })
      }),

    revokePortalTokens: async (command) =>
      trace('portal.commandStore.revokePortalTokens', async () => {
        assertRevokeTokenCommand(command)
        const revoked = await db.transaction(async (tx) => {
          const [live] = await tx
            .select({ id: portalTokens.id })
            .from(portalTokens)
            .where(
              and(
                eq(portalTokens.organizationId, unbrand(command.organizationId)),
                eq(portalTokens.propertyId, unbrand(command.propertyId)),
                eq(portalTokens.portalId, unbrand(command.portalId)),
                or(
                  eq(portalTokens.status, 'active'),
                  eq(portalTokens.status, 'rotating'),
                ),
              ),
            )
            .limit(1)
          if (!live) return 0
          // All Portal/token commands acquire the aggregate fence before token
          // row locks. Keeping one lock order avoids rotate-vs-revoke deadlocks.
          await fencePortalContent(tx, command)
          const rows = await tx
            .update(portalTokens)
            .set({
              status: 'revoked',
              revokedAt: command.occurredAt,
              retiredAt: command.occurredAt,
              revokedBy: unbrand(command.revokedBy),
              revokedReason: command.reason.trim(),
              gracePeriodEnds: null,
            })
            .where(
              and(
                eq(portalTokens.organizationId, unbrand(command.organizationId)),
                eq(portalTokens.propertyId, unbrand(command.propertyId)),
                eq(portalTokens.portalId, unbrand(command.portalId)),
                or(
                  eq(portalTokens.status, 'active'),
                  eq(portalTokens.status, 'rotating'),
                ),
              ),
            )
            .returning({ id: portalTokens.id })
          if (rows.length === 0) {
            throw portalError('revision_conflict', 'Portal token changed during revoke')
          }
          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
          return rows.length
        })

        return { revoked }
      }),

    deletePortalGroup: async (command) =>
      trace('portal.commandStore.deletePortalGroup', async () => {
        assertDeletePortalGroupCommand(command)
        await db.transaction(async (tx) => {
          const [deleted] = await tx
            .update(portalGroups)
            .set({ deletedAt: command.occurredAt, updatedAt: command.revision })
            .where(
              and(
                eq(portalGroups.organizationId, unbrand(command.organizationId)),
                eq(portalGroups.propertyId, unbrand(command.propertyId)),
                eq(portalGroups.id, unbrand(command.portalGroupId)),
                eq(portalGroups.updatedAt, command.expectedUpdatedAt),
                isNull(portalGroups.deletedAt),
              ),
            )
            .returning({ updatedAt: portalGroups.updatedAt })
          assertCommittedRevision(
            deleted,
            command.revision,
            'Portal Group',
            'Portal Group changed while the delete was being committed',
          )

          const membershipScope = [
            eq(portalGroupMemberships.organizationId, unbrand(command.organizationId)),
            eq(portalGroupMemberships.propertyId, unbrand(command.propertyId)),
            eq(portalGroupMemberships.portalGroupId, unbrand(command.portalGroupId)),
            isNull(portalGroupMemberships.effectiveTo),
          ] as const
          await tx
            .delete(portalGroupMemberships)
            .where(
              and(
                ...membershipScope,
                gte(portalGroupMemberships.effectiveFrom, command.occurredAt),
              ),
            )
          await tx
            .update(portalGroupMemberships)
            .set({
              effectiveTo: command.occurredAt,
              endReason: 'group_archived',
            })
            .where(
              and(
                ...membershipScope,
                lt(portalGroupMemberships.effectiveFrom, command.occurredAt),
              ),
            )

          await insertOutboxRow(tx, command.event, {
            recordedAt: command.occurredAt,
          })
        })
      }),
  }
}
