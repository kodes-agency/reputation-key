import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  cancelPropertyErase,
  confirmPropertyErase,
  previewPropertyErase,
  propertyEraseInventoryDigest,
  requestPropertyErase,
  type ErasePropertyDeps,
} from './erase-property'
import {
  isPropertyEraseError,
  propertyEraseConfirmationPhrase,
} from '../../domain/property-erase'
import type {
  PropertyEraseAuthority,
  PropertyEraseCommandStore,
} from '../ports/property-erase-command-store.port'
import type { PropertyEraseContributor } from '../ports/property-erase-contributor.port'
import type { Tx } from '#/shared/outbox/commit'

const ORG = 'org-erase'
const PROPERTY = '40000000-0000-4000-8000-000000000001'
const AUTHORITY = '40000000-0000-4000-8000-0000000000aa'
const NOW = new Date('2027-04-01T00:00:00.000Z')

const baseAuthority: PropertyEraseAuthority = {
  id: AUTHORITY,
  organizationId: ORG,
  propertyId: PROPERTY,
  state: 'requested',
  requestedByUserId: 'user-admin',
  identityVerificationRef: 'identity:webauthn:2027-04-01',
  supportOperatorId: 'ops-erase',
  supportAuthorizationRef: 'support:auth:zd-88213',
  inventoryRevision: 0,
  requestedAt: NOW,
  stateChangedAt: NOW,
}

function makeDeps(
  overrides: Partial<{
    lifecycleState: string | null
    isAdmin: boolean
    authority: PropertyEraseAuthority
    contributors: readonly PropertyEraseContributor[]
    store: Partial<PropertyEraseCommandStore>
  }> = {},
): ErasePropertyDeps & { recorded: Record<string, unknown[]> } {
  const recorded: Record<string, unknown[]> = {
    request: [],
    recordPreview: [],
    confirm: [],
    transition: [],
  }
  const current = overrides.authority ?? baseAuthority
  const store: PropertyEraseCommandStore = {
    request: async (input) => {
      recorded.request!.push(input)
      return current
    },
    load: async () => current,
    nextAdvanceable: async () => null,
    recordPreview: async (input) => {
      recorded.recordPreview!.push(input)
      return {
        ...current,
        state: 'previewed',
        inventoryRevision: input.inventoryRevision,
      }
    },
    confirm: async (input) => {
      recorded.confirm!.push(input)
      return { ...current, state: 'confirmed' }
    },
    transition: async (input) => {
      recorded.transition!.push(input)
      return { ...current, state: input.to }
    },
    recordContextReceipt: async () => undefined,
    completedContexts: async () => [],
    readInventory: async () => [],
    ...overrides.store,
  }
  return {
    store,
    authority: {
      readLifecycleState: async () =>
        overrides.lifecycleState === undefined ? 'archived' : overrides.lifecycleState,
      isCurrentAccountAdmin: async () => overrides.isAdmin ?? true,
    },
    contributors: overrides.contributors ?? [],
    runInventory: async (work) => work({} as Tx),
    now: () => NOW,
    recorded,
  }
}

const requestInput = {
  organizationId: ORG,
  propertyId: PROPERTY,
  requestedByUserId: 'user-admin',
  identityVerificationRef: 'identity:webauthn:2027-04-01',
  supportOperatorId: 'ops-erase',
  supportAuthorizationRef: 'support:auth:zd-88213',
  evidenceRef: 'erase:request:zd-88213',
  correlationId: 'corr-erase-1',
}

describe('permanent Property Erase — request gates (LIF-01-T19)', () => {
  it('refuses a Property that is not already archived', async () => {
    for (const state of ['active', 'suspended', 'disconnecting', 'purging']) {
      await expect(
        requestPropertyErase(makeDeps({ lifecycleState: state }), requestInput),
      ).rejects.toMatchObject({ code: 'property_not_archived' })
    }
    await expect(
      requestPropertyErase(makeDeps({ lifecycleState: null }), requestInput),
    ).rejects.toMatchObject({ code: 'authority_not_found' })
  })

  it('refuses a requester who is not a current AccountAdmin', async () => {
    await expect(
      requestPropertyErase(makeDeps({ isAdmin: false }), requestInput),
    ).rejects.toMatchObject({ code: 'requester_not_account_admin' })
  })

  it('requires an independent, content-free support authorization reference', async () => {
    await expect(
      requestPropertyErase(makeDeps(), {
        ...requestInput,
        supportAuthorizationRef: 'approved by the customer over the phone',
      }),
    ).rejects.toMatchObject({ code: 'support_authorization_missing' })

    // Same artefact for both = the tenant authorized their own erasure.
    await expect(
      requestPropertyErase(makeDeps(), {
        ...requestInput,
        supportAuthorizationRef: requestInput.identityVerificationRef,
      }),
    ).rejects.toMatchObject({ code: 'support_authorization_missing' })
  })

  it('records a well-formed request', async () => {
    const deps = makeDeps()
    await expect(requestPropertyErase(deps, requestInput)).resolves.toMatchObject({
      id: AUTHORITY,
    })
    expect(deps.recorded.request).toHaveLength(1)
  })
})

describe('permanent Property Erase — dependency inventory (LIF-01-T19)', () => {
  const contributor = (
    context: 'guest' | 'review',
    rowCount: number,
  ): PropertyEraseContributor => ({
    context,
    inventory: async () => [{ context, table: `${context}_rows`, rowCount }],
    erase: async () => rowCount,
  })

  it('enumerates every owning context BEFORE confirmation and stays content-free', async () => {
    const deps = makeDeps({
      contributors: [contributor('guest', 4), contributor('review', 0)],
    })
    const preview = await previewPropertyErase(deps, {
      authorityId: AUTHORITY,
      retentionPreviewRef: 'retention:preview:2027-04-01',
    })

    expect(preview.inventory).toEqual([
      { context: 'guest', table: 'guest_rows', rowCount: 4 },
      // A zero-row context still answers: an omitted context is data the admin
      // never agreed to destroy.
      { context: 'review', table: 'review_rows', rowCount: 0 },
    ])
    expect(preview.totalRowCount).toBe(4)
    expect(preview.inventoryRevision).toBe(1)
    for (const entry of preview.inventory) {
      expect(Object.keys(entry).sort()).toEqual(['context', 'rowCount', 'table'])
    }
  })

  it('digests the inventory independently of contributor order', () => {
    const a = [
      { context: 'guest' as const, table: 'guest_rows', rowCount: 4 },
      { context: 'review' as const, table: 'review_rows', rowCount: 1 },
    ]
    expect(propertyEraseInventoryDigest(a)).toBe(
      propertyEraseInventoryDigest([...a].reverse()),
    )
    expect(propertyEraseInventoryDigest(a)).not.toBe(
      propertyEraseInventoryDigest([{ ...a[0]!, rowCount: 5 }, a[1]!]),
    )
  })
})

describe('permanent Property Erase — typed confirmation (LIF-01-T19)', () => {
  const previewed: PropertyEraseAuthority = {
    ...baseAuthority,
    state: 'previewed',
    inventoryRevision: 3,
    inventoryDigest: 'f'.repeat(64),
    retentionPreviewRef: 'retention:preview:2027-04-01',
  }

  it('requires the exact phrase naming this Property', async () => {
    const deps = makeDeps({ authority: previewed })
    for (const typed of [
      'ERASE PROPERTY',
      'erase property ' + PROPERTY,
      `ERASE PROPERTY ${'40000000-0000-4000-8000-000000000002'}`,
      'yes',
    ]) {
      await expect(
        confirmPropertyErase(deps, {
          authorityId: AUTHORITY,
          typedConfirmation: typed,
          inventoryRevision: 3,
          graceMs: 3_600_000,
        }),
      ).rejects.toMatchObject({ code: 'confirmation_mismatch' })
    }
    await expect(
      confirmPropertyErase(deps, {
        authorityId: AUTHORITY,
        typedConfirmation: `  ${propertyEraseConfirmationPhrase(PROPERTY)}  `,
        inventoryRevision: 3,
        graceMs: 3_600_000,
      }),
    ).resolves.toMatchObject({ state: 'confirmed' })
  })

  it('rejects a confirmation against a stale inventory revision', async () => {
    const deps = makeDeps({ authority: previewed })
    await expect(
      confirmPropertyErase(deps, {
        authorityId: AUTHORITY,
        typedConfirmation: propertyEraseConfirmationPhrase(PROPERTY),
        inventoryRevision: 2,
        graceMs: 3_600_000,
      }),
    ).rejects.toMatchObject({ code: 'stale_inventory_revision' })
  })

  it('refuses confirmation before an inventory and retention preview exist', async () => {
    const deps = makeDeps({
      authority: { ...baseAuthority, state: 'previewed', inventoryRevision: 1 },
    })
    await expect(
      confirmPropertyErase(deps, {
        authorityId: AUTHORITY,
        typedConfirmation: propertyEraseConfirmationPhrase(PROPERTY),
        inventoryRevision: 1,
        graceMs: 3_600_000,
      }),
    ).rejects.toMatchObject({ code: 'preview_missing' })
  })
})

describe('permanent Property Erase — irreversible boundary (LIF-01-T19)', () => {
  it('refuses cancellation once purging has begun', async () => {
    for (const state of ['purging', 'purged'] as const) {
      const deps = makeDeps({ authority: { ...baseAuthority, state } })
      await expect(
        cancelPropertyErase(deps, {
          authorityId: AUTHORITY,
          reasonCode: 'operator_recall',
        }),
      ).rejects.toMatchObject({ code: 'irreversible_state' })
    }
  })

  it('still allows cancellation up to purge_pending', async () => {
    for (const state of [
      'requested',
      'previewed',
      'confirmed',
      'purge_pending',
    ] as const) {
      const deps = makeDeps({ authority: { ...baseAuthority, state } })
      await expect(
        cancelPropertyErase(deps, {
          authorityId: AUTHORITY,
          reasonCode: 'operator_recall',
        }),
      ).resolves.toMatchObject({ state: 'cancelled' })
    }
  })

  it('raises erase failures under their own tag, never PropertyError', async () => {
    // `propertyErrorStatus` maps every PropertyError code to an HTTP status.
    // Erase failures must not be mappable, because nothing may serve them.
    const deps = makeDeps({ isAdmin: false })
    const error = await requestPropertyErase(deps, requestInput).catch((e: unknown) => e)
    expect(isPropertyEraseError(error)).toBe(true)
    expect((error as { _tag: string })._tag).toBe('PropertyEraseError')
  })
})

// ── The negative proof: no tenant-facing path reaches this use case ──

const ROOT = resolve(import.meta.dirname, '../../../../..')

function walk(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' ? [] : walk(full)
    }
    return /\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name) ? [full] : []
  })
}

describe('permanent Property Erase has no tenant-facing entry point (LIF-01-T19)', () => {
  const sources = walk(join(ROOT, 'src')).filter(
    (file) => !file.endsWith('erase-property.ts'),
  )

  it('is not imported by any route, server function or public API surface', () => {
    const tenantSurfaces = sources.filter((file) => {
      const relative = file.slice(ROOT.length + 1)
      return (
        relative.startsWith('src/routes/') ||
        relative.includes('/server/') ||
        relative.endsWith('/public-api.ts') ||
        relative.startsWith('src/components/') ||
        relative.startsWith('src/app/')
      )
    })
    const importers = tenantSurfaces.filter((file) =>
      /use-cases\/erase-property|domain\/property-erase|property-erase-command-store/u.test(
        readFileSync(file, 'utf8'),
      ),
    )
    expect(
      importers.map((file) => file.slice(ROOT.length + 1)),
      'permanent erase must be reachable only from scripts/ops/property-erase.ts',
    ).toEqual([])
  })

  it('performs no capability check, because property.erase stays blocked', () => {
    // A capability check here would imply a capability that could be granted.
    // The only authorization is an independent support authorization reference.
    const source = readFileSync(
      join(ROOT, 'src/contexts/property/application/use-cases/erase-property.ts'),
      'utf8',
    )
    expect(source).not.toMatch(/checkBetaCapability|requireCapability|'property\.erase'/u)
  })
})
