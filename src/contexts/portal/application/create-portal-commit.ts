// Portal context — building the command that creates one new Portal, once every
// choice (address, group, source, languages, managers) has been resolved. The
// use case hands the command to the Portal command store.

import type { AuthContext } from '#/shared/domain/auth-context'
import { propertyId } from '#/shared/domain/ids'
import { buildPortal } from '../domain/constructors'
import { portalCreated, portalResponsibilityNeeded } from '../domain/events'
import { derivePortalHealth } from '../domain/portal-health'
import type { NewPortalLocales } from '../domain/portal-new-locales'
import type { Portal, PortalGroup, PortalId } from '../domain/types'
import type { UserId } from '#/shared/domain/ids'
import type { CreatePortalCommand } from './ports/portal-command-store.port'
import type { CreatePortalInput } from './dto/create-portal.dto'
import { buildGroupMembership } from './create-portal-resolvers'
import { planPortalContentCopy, type PortalCopySource } from './portal-content-copy'

export type NewPortalCommandDeps = Readonly<{
  idGen: () => PortalId
  entityIdGen: () => string
  clock: () => Date
}>

/** Everything about the new Portal that was decided before the address was. */
export type NewPortalPlan = Readonly<{
  input: CreatePortalInput
  locales: NewPortalLocales
  managerIds: readonly UserId[]
  group: PortalGroup | null
  source: PortalCopySource | null
}>

/** The command for the Portal at `slug` (a copy's settings first; what was typed wins), with every fact. */
export function buildCreatePortalCommand(
  deps: NewPortalCommandDeps,
  ctx: AuthContext,
  plan: NewPortalPlan,
  slug: string,
): CreatePortalCommand {
  const { input, locales, managerIds, group, source } = plan
  const now = deps.clock()
  const id = deps.idGen()
  const copy = source
    ? planPortalContentCopy({
        source,
        target: { portalId: id, locales },
        idGen: deps.entityIdGen,
        now,
      })
    : null
  const built = buildPortal({
    id,
    organizationId: ctx.organizationId,
    propertyId: propertyId(input.propertyId),
    name: input.name,
    providedSlug: slug,
    description: input.description ?? copy?.settings.description,
    theme: input.theme ?? copy?.settings.theme,
    privateFeedbackThreshold:
      input.privateFeedbackThreshold ?? copy?.settings.privateFeedbackThreshold,
    createdBy: ctx.userId,
    hasInitialResponsibleManager: managerIds.length > 0,
    primaryGuestLocale: locales.primary,
    additionalGuestLocales: locales.additional,
    now,
  })
  if (built.isErr()) throw built.error
  const portal: Portal = {
    ...built.value,
    linktreeEnabled: copy?.settings.linktreeEnabled ?? true,
  }

  const hasManager = managerIds.length > 0
  const factBase = {
    portalId: portal.id,
    organizationId: portal.organizationId,
    propertyId: portal.propertyId,
    sourceAggregateVersion: portal.updatedAt.toISOString(),
    occurredAt: portal.createdAt,
  }
  return {
    organizationId: ctx.organizationId,
    portal,
    initialResponsibleManagerIds: managerIds,
    event: portalCreated({ ...factBase, publicationState: portal.publicationState }),
    ...(hasManager
      ? {}
      : { responsibilityNeededEvent: portalResponsibilityNeeded(factBase) }),
    ...(group ? { groupMembership: buildGroupMembership(group, portal) } : {}),
    ...(copy ? { copiedContent: copy.content } : {}),
    health: {
      id: deps.entityIdGen(),
      value: derivePortalHealth({
        publicationState: portal.publicationState,
        propertyAvailable: true,
        hasActivePublicationSnapshot: false,
        hasResolvablePublicAddress: false,
        hasResponsibleManager: hasManager,
        googleDestinationState: 'unavailable',
      }),
      sourceVersion: portal.updatedAt.toISOString(),
      effectiveAt: portal.createdAt,
      observedAt: portal.createdAt,
    },
  }
}
