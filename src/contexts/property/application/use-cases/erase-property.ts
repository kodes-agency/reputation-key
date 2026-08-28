// LIF-01-T19 — request, preview, confirm and cancel a permanent Property Erase.
//
// READ `src/contexts/property/domain/property-erase.ts` FIRST for the posture:
// `property.erase` stays a BLOCKED tenant capability and there is no route or
// server function into this module. Every function here takes an operator
// context because the only caller is `scripts/ops/property-erase.ts`.
//
// The four gates, in the order they must hold:
//   1. the Property is already archived — erasure is not a shortcut past the
//      recoverable lifecycle;
//   2. the requester is a CURRENT AccountAdmin — an ex-admin cannot erase;
//   3. an INDEPENDENT support authorization reference is supplied;
//   4. the typed confirmation matches `ERASE PROPERTY <property-id>` and names
//      the inventory revision the admin was actually shown.

import { createHash } from 'node:crypto'
import {
  assertValidPropertyEraseTransition,
  matchesPropertyEraseConfirmation,
  propertyEraseError,
} from '../../domain/property-erase'
import type {
  PropertyEraseAuthority,
  PropertyEraseCommandStore,
} from '../ports/property-erase-command-store.port'
import type {
  PropertyEraseContributor,
  PropertyEraseInventoryEntry,
} from '../ports/property-erase-contributor.port'
import type { Tx } from '#/shared/outbox/commit'

const CONTENT_FREE_REF = /^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$/u

/** What the erase path needs to know about the target and the requester. */
export type PropertyEraseAuthorityReader = Readonly<{
  /** Lifecycle state of the Property, or null when it does not exist. */
  readLifecycleState(organizationId: string, propertyId: string): Promise<string | null>
  /** Is this user a CURRENT AccountAdmin of the Organization, right now? */
  isCurrentAccountAdmin(organizationId: string, userId: string): Promise<boolean>
}>

export type ErasePropertyDeps = Readonly<{
  store: PropertyEraseCommandStore
  authority: PropertyEraseAuthorityReader
  contributors: readonly PropertyEraseContributor[]
  /** Runs the read-only inventory inside one transaction. */
  runInventory<T>(work: (tx: Tx) => Promise<T>): Promise<T>
  now: () => Date
}>

export type RequestPropertyEraseInput = Readonly<{
  organizationId: string
  propertyId: string
  requestedByUserId: string
  identityVerificationRef: string
  supportOperatorId: string
  supportAuthorizationRef: string
  evidenceRef: string
  correlationId: string
}>

function assertContentFreeRef(
  value: string,
  code: 'support_authorization_missing' | 'identity_verification_missing',
): void {
  if (!CONTENT_FREE_REF.test(value)) {
    throw propertyEraseError(
      code,
      'Erase authorization references must be content-free opaque tokens',
    )
  }
}

/**
 * Gate 1-3. Records the request; authorizes nothing.
 *
 * The Property must already be archived. Allowing erasure straight from
 * `active` would let a support-mediated path skip the recoverable window the
 * whole lifecycle is built around.
 */
export async function requestPropertyErase(
  deps: ErasePropertyDeps,
  input: RequestPropertyEraseInput,
): Promise<PropertyEraseAuthority> {
  const lifecycleState = await deps.authority.readLifecycleState(
    input.organizationId,
    input.propertyId,
  )
  if (lifecycleState === null) {
    throw propertyEraseError(
      'authority_not_found',
      'Property does not exist in this Organization',
    )
  }
  if (lifecycleState !== 'archived') {
    throw propertyEraseError(
      'property_not_archived',
      `Permanent erase requires an archived Property (state "${lifecycleState}")`,
      { state: lifecycleState },
    )
  }
  if (
    !(await deps.authority.isCurrentAccountAdmin(
      input.organizationId,
      input.requestedByUserId,
    ))
  ) {
    // A former AccountAdmin, a Manager, or a support agent impersonating one
    // must not be able to originate a permanent erasure.
    throw propertyEraseError(
      'requester_not_account_admin',
      'Permanent erase must be requested by a current AccountAdmin',
    )
  }
  assertContentFreeRef(input.identityVerificationRef, 'identity_verification_missing')
  assertContentFreeRef(input.supportAuthorizationRef, 'support_authorization_missing')
  if (input.supportAuthorizationRef === input.identityVerificationRef) {
    // Independence is the point: if the support authorization is the same
    // artefact as the tenant's identity verification, the tenant authorized
    // their own irreversible erasure.
    throw propertyEraseError(
      'support_authorization_missing',
      'Support authorization must be independent of the requester identity verification',
    )
  }

  return deps.store.request({ ...input, requestedAt: deps.now() })
}

/**
 * Canonical, content-free digest of the inventory the admin was shown.
 *
 * Sorted so the digest depends on the counts, not on contributor order.
 */
export function propertyEraseInventoryDigest(
  entries: readonly PropertyEraseInventoryEntry[],
): string {
  const canonical = [...entries]
    .map((entry) => `${entry.context}:${entry.table}:${entry.rowCount}`)
    .sort()
    .join('\n')
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

export type PropertyErasePreview = Readonly<{
  authority: PropertyEraseAuthority
  inventory: readonly PropertyEraseInventoryEntry[]
  inventoryRevision: number
  inventoryDigest: string
  totalRowCount: number
}>

/**
 * Gate 4a — the dependency inventory and the export/retention preview.
 *
 * Every registered contributor answers, including with zero rows: a context
 * missing from the preview is a context whose data the admin never agreed to
 * destroy.
 */
export async function previewPropertyErase(
  deps: ErasePropertyDeps,
  input: Readonly<{
    authorityId: string
    retentionPreviewRef: string
    exportEvidenceRef?: string
  }>,
): Promise<PropertyErasePreview> {
  const authority = await loadAuthority(deps, input.authorityId)
  assertValidPropertyEraseTransition(authority.state, 'previewed')

  const scope = {
    organizationId: authority.organizationId,
    propertyId: authority.propertyId,
  }
  const inventory = await deps.runInventory(async (tx) => {
    const perContext = await Promise.all(
      deps.contributors.map(async (contributor) => {
        const entries = await contributor.inventory(tx, scope)
        // A contributor answering for a context it does not own would make the
        // preview attributable to the wrong owner.
        for (const entry of entries) {
          if (entry.context !== contributor.context) {
            throw propertyEraseError(
              'preview_missing',
              `Contributor ${contributor.context} answered for ${entry.context}`,
            )
          }
        }
        return entries
      }),
    )
    return perContext.flat()
  })

  const inventoryRevision = authority.inventoryRevision + 1
  const inventoryDigest = propertyEraseInventoryDigest(inventory)
  const updated = await deps.store.recordPreview({
    authorityId: authority.id,
    inventoryRevision,
    inventoryDigest,
    retentionPreviewRef: input.retentionPreviewRef,
    ...(input.exportEvidenceRef ? { exportEvidenceRef: input.exportEvidenceRef } : {}),
    occurredAt: deps.now(),
  })

  return {
    authority: updated,
    inventory,
    inventoryRevision,
    inventoryDigest,
    totalRowCount: inventory.reduce((total, entry) => total + entry.rowCount, 0),
  }
}

/**
 * Gate 4b — the typed confirmation.
 *
 * The confirmation is bound to BOTH the Property and the inventory revision it
 * was shown against. Confirming a stale revision is refused, because the admin
 * would be agreeing to destroy a different set of rows than the one they read.
 */
export async function confirmPropertyErase(
  deps: ErasePropertyDeps,
  input: Readonly<{
    authorityId: string
    typedConfirmation: string
    inventoryRevision: number
    graceMs: number
  }>,
): Promise<PropertyEraseAuthority> {
  const authority = await loadAuthority(deps, input.authorityId)
  assertValidPropertyEraseTransition(authority.state, 'confirmed')
  if (
    authority.inventoryDigest === undefined ||
    authority.retentionPreviewRef === undefined
  ) {
    throw propertyEraseError(
      'preview_missing',
      'Permanent erase cannot be confirmed before the dependency inventory and retention preview',
    )
  }
  if (input.inventoryRevision !== authority.inventoryRevision) {
    throw propertyEraseError(
      'stale_inventory_revision',
      `Confirmation names inventory revision ${input.inventoryRevision}; the current revision is ${authority.inventoryRevision}`,
      { expected: authority.inventoryRevision, received: input.inventoryRevision },
    )
  }
  if (!matchesPropertyEraseConfirmation(authority.propertyId, input.typedConfirmation)) {
    throw propertyEraseError(
      'confirmation_mismatch',
      'Typed confirmation must be exactly `ERASE PROPERTY <property-id>`',
    )
  }

  const now = deps.now()
  return deps.store.confirm({
    authorityId: authority.id,
    // The digest binds the confirmation to the phrase without storing what was
    // typed; the phrase names the Property, so it cannot be reused elsewhere.
    confirmationDigest: createHash('sha256')
      .update(input.typedConfirmation.trim(), 'utf8')
      .digest('hex'),
    inventoryRevision: authority.inventoryRevision,
    graceExpiresAt: new Date(now.getTime() + input.graceMs),
    occurredAt: now,
  })
}

/**
 * Cancel — legal up to and including `purge_pending`, refused after.
 *
 * The refusal is asserted by the domain transition table here AND by the
 * database trigger on `property_erase_authorities`. Both must hold.
 */
export async function cancelPropertyErase(
  deps: ErasePropertyDeps,
  input: Readonly<{ authorityId: string; reasonCode: string }>,
): Promise<PropertyEraseAuthority> {
  const authority = await loadAuthority(deps, input.authorityId)
  assertValidPropertyEraseTransition(authority.state, 'cancelled')
  return deps.store.transition({
    authorityId: authority.id,
    from: authority.state,
    to: 'cancelled',
    reasonCode: input.reasonCode,
    occurredAt: deps.now(),
  })
}

async function loadAuthority(
  deps: ErasePropertyDeps,
  authorityId: string,
): Promise<PropertyEraseAuthority> {
  const authority = await deps.store.load(authorityId)
  if (!authority) {
    throw propertyEraseError('authority_not_found', 'Property erase authority not found')
  }
  return authority
}
