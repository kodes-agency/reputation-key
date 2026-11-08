// Portal context — the narrow commands that change a Portal's state.
//
// Each intent names one thing a person does: go live, take the page down,
// archive, restore, edit the settings, change the address, change the
// languages. It asks for its own permission, refuses what that action may not
// touch, and commits through `commitPortalChange`.

import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId as toPortalId } from '#/shared/domain/ids'
import type { Permission } from '#/shared/domain/permissions'
import type { Result } from '#/shared/domain'
import { loadPortalOrThrow } from '../application/load-accessible-portal'
import {
  assertPropertyAllowsPublication,
  loadVerifiedGoogleReviewDestination,
} from '../application/portal-publication-readiness'
import type {
  ChangePortalLanguagesInput,
  ChangePortalSlugInput,
  PortalIdInput,
  UpdatePortalSettingsInput,
} from '../application/dto/portal-intents.dto'
import { portalError, type PortalError } from '../domain/errors'
import {
  validateDescription,
  validatePortalName,
  validatePortalTheme,
  validatePrivateFeedbackThreshold,
  validateSlug,
} from '../domain/rules'
import { transitionPortalPublication } from '../domain/portal-publication'
import type { Portal } from '../domain/types'
import {
  commitPortalChange,
  type PortalIntentDeps,
  type PortalPatch,
} from './portal-change.server'

const UPDATE = {
  permission: 'portal.update' as Permission,
  forbiddenMessage: 'this role cannot edit portals',
}
const ARCHIVE = {
  permission: 'portal.delete' as Permission,
  forbiddenMessage: 'this role cannot archive portals',
}

function unwrap<T>(r: Result<T, PortalError>): T {
  if (r.isErr()) throw r.error
  return r.value
}

const loadPortal = (
  deps: PortalIntentDeps,
  ctx: AuthContext,
  input: PortalIdInput,
  access: typeof UPDATE,
) => loadPortalOrThrow(deps, ctx, toPortalId(input.portalId), access)

/** A removed staff Portal never comes back; any other archived Portal is read-only. */
function assertEditable(existing: Portal): void {
  if (existing.publicationState !== 'archived') return
  throw existing.kind === 'personal'
    ? portalError(
        'personal_portal_restore_locked',
        'A removed staff Portal cannot be restored. Add the person again',
      )
    : portalError(
        'portal_inactive',
        'Archived Portal configuration is read-only; restore it before editing',
      )
}

function assertNotPersonalRename(existing: Portal, name?: string, slug?: string): void {
  if (existing.kind !== 'personal') return
  if (
    (name !== undefined && name !== existing.name) ||
    (slug !== undefined && slug !== existing.slug)
  ) {
    throw portalError('personal_portal_rename_locked', 'Rename this person from Staff')
  }
}

/** Moves the Portal to `state` through the allowed transitions only. */
function nextState(existing: Portal, state: Portal['publicationState']) {
  const transition = transitionPortalPublication(existing.publicationState, state)
  if (typeof transition !== 'string') {
    throw portalError(
      'invalid_publication_transition',
      `cannot transition portal from ${transition.from} to ${transition.to}`,
    )
  }
  return transition
}

/** Turning the switch on must not starve a running goal on private ratings. */
async function assertSkipSwitchAllowed(
  deps: PortalIntentDeps,
  ctx: AuthContext,
  existing: Portal,
): Promise<void> {
  const block = await deps.ratingGoalGuard.findRunningRatingGoalBlock(
    ctx.organizationId,
    existing.propertyId,
    existing.id,
  )
  if (!block) return
  throw portalError(
    'running_rating_goal',
    block === 'staff_scan_target'
      ? 'This portal has a running scan target for staff. End the target first.'
      : block === 'portal'
        ? 'This portal has a running goal on private ratings. End the goal first.'
        : 'This is the last portal collecting ratings for a running goal. End the goal first.',
  )
}

/** Fields settable without I/O. `undefined` leaves a field alone; `null` clears it. */
export function resolveSettingsFields(
  input: UpdatePortalSettingsInput,
  existing: Portal,
): Partial<PortalPatch> {
  if (
    input.skipPrivateRating !== undefined &&
    typeof input.skipPrivateRating !== 'boolean'
  ) {
    throw portalError(
      'invalid_skip_private_rating',
      'Choose whether this portal skips the private rating.',
    )
  }
  const requestedHeroImageUrl = (input as { heroImageUrl?: unknown }).heroImageUrl
  if (requestedHeroImageUrl !== undefined && requestedHeroImageUrl !== null) {
    throw portalError(
      'invalid_url',
      'Portal hero image URLs are server-owned upload derivatives',
    )
  }
  return {
    name:
      input.name !== undefined ? unwrap(validatePortalName(input.name)) : existing.name,
    description:
      input.description !== undefined
        ? unwrap(validateDescription(input.description))
        : existing.description,
    // `null` clears the hero image; an absent key leaves it untouched.
    heroImageUrl: input.heroImageUrl === null ? null : existing.heroImageUrl,
    theme:
      input.theme !== undefined
        ? unwrap(validatePortalTheme(input.theme))
        : existing.theme,
    privateFeedbackThreshold:
      input.privateFeedbackThreshold !== undefined
        ? unwrap(validatePrivateFeedbackThreshold(input.privateFeedbackThreshold))
        : existing.privateFeedbackThreshold,
    skipPrivateRating: input.skipPrivateRating ?? existing.skipPrivateRating,
  }
}

export const updatePortalSettings =
  (deps: PortalIntentDeps) =>
  async (input: UpdatePortalSettingsInput, ctx: AuthContext): Promise<Portal> => {
    const existing = await loadPortal(deps, ctx, input, UPDATE)
    assertNotPersonalRename(existing, input.name)
    assertEditable(existing)
    if (input.skipPrivateRating === true && !existing.skipPrivateRating) {
      await assertSkipSwitchAllowed(deps, ctx, existing)
    }
    return commitPortalChange(deps, ctx, existing, resolveSettingsFields(input, existing))
  }

export const changePortalSlug =
  (deps: PortalIntentDeps) =>
  async (input: ChangePortalSlugInput, ctx: AuthContext): Promise<Portal> => {
    const existing = await loadPortal(deps, ctx, input, UPDATE)
    assertNotPersonalRename(existing, undefined, input.slug)
    assertEditable(existing)
    // An unchanged slug is not re-validated and never hits the uniqueness probe.
    if (input.slug === existing.slug) return existing
    const slug = unwrap(validateSlug(input.slug))
    const taken = await deps.portalRepo.slugExists(
      ctx.organizationId,
      existing.propertyId as string,
      slug,
      existing.id,
    )
    if (taken) throw portalError('slug_taken', 'a portal with this slug already exists')
    return commitPortalChange(deps, ctx, existing, { slug })
  }

export const changePortalLanguages =
  (deps: PortalIntentDeps) =>
  async (input: ChangePortalLanguagesInput, ctx: AuthContext): Promise<Portal> => {
    const existing = await loadPortal(deps, ctx, input, UPDATE)
    assertEditable(existing)
    const primaryGuestLocale = input.primaryGuestLocale ?? existing.primaryGuestLocale
    const additionalGuestLocales =
      input.additionalGuestLocales ?? existing.additionalGuestLocales
    if (
      additionalGuestLocales.includes(primaryGuestLocale) ||
      new Set(additionalGuestLocales).size !== additionalGuestLocales.length
    ) {
      throw portalError(
        'publication_snapshot_unavailable',
        'Additional guest locales must be unique and must not repeat the primary locale',
      )
    }
    return commitPortalChange(deps, ctx, existing, {
      primaryGuestLocale,
      additionalGuestLocales,
    })
  }

export const publishPortal =
  (deps: PortalIntentDeps) =>
  async (input: PortalIdInput, ctx: AuthContext): Promise<Portal> => {
    const existing = await loadPortal(deps, ctx, input, UPDATE)
    if (existing.kind === 'personal') assertEditable(existing)
    const publicationState = nextState(existing, 'published')
    if (publicationState === existing.publicationState) return existing
    await assertPropertyAllowsPublication(deps, ctx.organizationId, existing)
    const destination = await loadVerifiedGoogleReviewDestination(
      deps,
      ctx.organizationId,
      existing,
    )
    return commitPortalChange(deps, ctx, existing, { publicationState }, destination)
  }

export const disablePortal =
  (deps: PortalIntentDeps) =>
  async (input: PortalIdInput, ctx: AuthContext): Promise<Portal> => {
    const existing = await loadPortal(deps, ctx, input, UPDATE)
    assertEditable(existing)
    return commitPortalChange(deps, ctx, existing, {
      publicationState: nextState(existing, 'disabled'),
    })
  }

/** Archives an already-authorized Portal; the caller owns who may do so. */
export const archiveLoadedPortal = (
  deps: PortalIntentDeps,
  ctx: AuthContext,
  existing: Portal,
): Promise<Portal> =>
  commitPortalChange(deps, ctx, existing, {
    publicationState: nextState(existing, 'archived'),
  })

export const archivePortal =
  (deps: PortalIntentDeps) =>
  async (input: PortalIdInput, ctx: AuthContext): Promise<Portal> => {
    const existing = await loadPortal(deps, ctx, input, ARCHIVE)
    if (existing.kind === 'personal') {
      throw portalError(
        'personal_portal_archive_locked',
        'Remove this person from Staff to archive their Portal',
      )
    }
    return archiveLoadedPortal(deps, ctx, existing)
  }

export const restorePortal =
  (deps: PortalIntentDeps) =>
  async (input: PortalIdInput, ctx: AuthContext): Promise<Portal> => {
    const existing = await loadPortal(deps, ctx, input, UPDATE)
    if (existing.kind === 'personal' && existing.publicationState === 'archived') {
      assertEditable(existing)
    }
    if (existing.publicationState !== 'archived') {
      throw portalError(
        'invalid_publication_transition',
        `cannot transition portal from ${existing.publicationState} to disabled`,
      )
    }
    return commitPortalChange(deps, ctx, existing, { publicationState: 'disabled' })
  }
