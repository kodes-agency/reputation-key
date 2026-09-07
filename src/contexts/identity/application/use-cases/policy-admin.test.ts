// BQC-2.7 — property capability provisioning + the ops:property-capabilities
// command core.
//
// The invariant under test: a property's allowlist is independent of its
// organization's, an empty property set denies every non-core capability, and
// provisioning copies the organization's set onto the property idempotently.
// The operator command reports without writing until --apply.

import { describe, expect, it, vi } from 'vitest'
import {
  createPolicyAdminOps,
  createPropertyCapabilityOperatorAction,
  createPropertyCapabilityProvisioning,
  parsePropertyCapabilityCommand,
  type PolicyAdminDeps,
  type PropertyCapabilityProvisioningDeps,
} from './policy-admin'
import type { PolicyAdminCommandStore } from '../ports/policy-admin-command-store.port'

const ORG_ID = 'org-1'
const OTHER_ORG_ID = 'org-2'
const OPERATOR_ID = 'operator-1'
const PROPERTY_ID = '00000000-0000-4000-8000-000000000001'
const OTHER_PROPERTY_ID = '00000000-0000-4000-8000-000000000002'
const ORG_CAPABILITIES = ['inbox.use', 'reply.publish', 'review.sync'] as const

function stubPolicyAdminCommandStore(): PolicyAdminCommandStore {
  return {
    setOrganizationCapability: vi.fn(async () => undefined),
    setPropertyCapability: vi.fn(async () => undefined),
    setOrganizationSuspension: vi.fn(async () => undefined),
    setPropertySuspension: vi.fn(async () => undefined),
    grantPropertyAccess: vi.fn(async () => undefined),
    revokePropertyAccess: vi.fn(async () => undefined),
  }
}

function policyAdminHarness(
  overrides: Partial<
    Pick<
      PolicyAdminDeps,
      'commandStore' | 'refreshPolicy' | 'reconcileResponsibleManagerEligibility'
    >
  > = {},
) {
  const commandStore: PolicyAdminCommandStore =
    overrides.commandStore ?? stubPolicyAdminCommandStore()
  const refreshPolicy = overrides.refreshPolicy ?? vi.fn(async () => undefined)
  const reconcileResponsibleManagerEligibility =
    overrides.reconcileResponsibleManagerEligibility ?? vi.fn(async () => undefined)
  const deps: PolicyAdminDeps = {
    clock: () => new Date('2026-08-27T10:00:00.000Z'),
    isCoreCapability: () => false,
    isBlockedCapability: () => false,
    listAllCapabilities: () => ['portal.read'],
    explainPolicyDecision: async () => {
      throw new Error('not used')
    },
    refreshPolicy,
    commandStore,
    loadOrgPolicyState: async () => ({
      policy: null,
      capabilities: [],
      propertyPolicies: [],
    }),
    reconcileResponsibleManagerEligibility,
    listActiveGrantsForOrg: async () => [],
  }
  return {
    ops: createPolicyAdminOps(deps),
    commandStore,
    refreshPolicy,
    reconcileResponsibleManagerEligibility,
  }
}

describe('atomic policy-admin orchestration', () => {
  it('passes the mutation through the command store before refreshing', async () => {
    const order: string[] = []
    const setOrganizationCapability = vi.fn(async () => {
      order.push('atomic-command')
    })
    const harness = policyAdminHarness({
      commandStore: {
        ...stubPolicyAdminCommandStore(),
        setOrganizationCapability,
      },
      refreshPolicy: vi.fn(async () => {
        order.push('refresh')
      }),
    })

    await harness.ops.setOrgCapability({
      organizationId: ORG_ID,
      capability: 'portal.read',
      enabled: true,
      reason: 'approved beta access',
      actorUserId: OPERATOR_ID,
      now: new Date('2026-08-27T10:00:00.000Z'),
    })

    expect(order).toEqual(['atomic-command', 'refresh'])
    expect(setOrganizationCapability).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      capability: 'portal.read',
      enabled: true,
      createdBy: OPERATOR_ID,
    })
  })

  it('does not refresh when the atomic command rolls back', async () => {
    const harness = policyAdminHarness({
      commandStore: {
        ...stubPolicyAdminCommandStore(),
        setOrganizationCapability: vi.fn(async () => {
          throw new Error('transaction rolled back')
        }),
      },
    })

    await expect(
      harness.ops.setOrgCapability({
        organizationId: ORG_ID,
        capability: 'portal.read',
        enabled: true,
        reason: 'approved beta access',
        actorUserId: OPERATOR_ID,
        now: new Date('2026-08-27T10:00:00.000Z'),
      }),
    ).rejects.toThrow('transaction rolled back')
    expect(harness.refreshPolicy).not.toHaveBeenCalled()
  })

  it('retries the idempotent revoke path and reconciles managers only post-commit', async () => {
    const order: string[] = []
    let firstReconciliation = true
    const harness = policyAdminHarness({
      commandStore: {
        ...stubPolicyAdminCommandStore(),
        revokePropertyAccess: vi.fn(async () => {
          order.push('atomic-command')
        }),
      },
      refreshPolicy: vi.fn(async () => {
        order.push('refresh')
      }),
      reconcileResponsibleManagerEligibility: vi.fn(async () => {
        order.push('reconcile')
        if (firstReconciliation) {
          firstReconciliation = false
          throw new Error('temporary reconciliation failure')
        }
      }),
    })
    const command = {
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      userId: 'manager-1',
      reason: 'manager scope changed',
      actorUserId: OPERATOR_ID,
      now: new Date('2026-08-27T10:00:00.000Z'),
    }

    await expect(harness.ops.revokePropertyAccessOp(command)).rejects.toThrow(
      'temporary reconciliation failure',
    )
    await expect(harness.ops.revokePropertyAccessOp(command)).resolves.toBeUndefined()

    expect(order).toEqual([
      'atomic-command',
      'refresh',
      'reconcile',
      'atomic-command',
      'refresh',
      'reconcile',
    ])
  })
})

function deps(
  over: Partial<{
    organizationCapabilities: ReadonlyArray<string>
    propertyCapabilities: Readonly<Record<string, ReadonlyArray<string>>>
    provisionablePropertyIds: ReadonlyArray<string>
    propertyOwners: Readonly<Record<string, string>>
  }> = {},
) {
  const propertyCapabilities = over.propertyCapabilities ?? {}
  const propertyOwners = over.propertyOwners ?? {
    [PROPERTY_ID]: ORG_ID,
    [OTHER_PROPERTY_ID]: OTHER_ORG_ID,
  }
  const listOrganizationCapabilities = vi
    .fn()
    .mockResolvedValue(over.organizationCapabilities ?? ORG_CAPABILITIES)
  const listPropertyCapabilities = vi.fn(
    async (propertyId: string) => propertyCapabilities[propertyId] ?? [],
  )
  const getPropertyOrganizationId = vi.fn(
    async (propertyId: string) => propertyOwners[propertyId] ?? null,
  )
  const listProvisionablePropertyIds = vi
    .fn()
    .mockResolvedValue(over.provisionablePropertyIds ?? [PROPERTY_ID])
  // The real repository returns exactly the capabilities it inserted.
  const provisionPropertyCapabilities = vi.fn(
    async (input: { propertyId: string }): Promise<ReadonlyArray<string>> => {
      const held = new Set(propertyCapabilities[input.propertyId] ?? [])
      return (over.organizationCapabilities ?? ORG_CAPABILITIES).filter(
        (capability) => !held.has(capability),
      )
    },
  )
  const refreshPolicy = vi.fn().mockResolvedValue(undefined)
  const bound: PropertyCapabilityProvisioningDeps = {
    listOrganizationCapabilities,
    listPropertyCapabilities,
    getPropertyOrganizationId,
    listProvisionablePropertyIds,
    provisionPropertyCapabilities,
    refreshPolicy,
  }
  return {
    ops: createPropertyCapabilityProvisioning(bound),
    listOrganizationCapabilities,
    listPropertyCapabilities,
    getPropertyOrganizationId,
    listProvisionablePropertyIds,
    provisionPropertyCapabilities,
    refreshPolicy,
  }
}

function captureIO() {
  const lines: string[] = []
  return { io: { out: (line: string) => lines.push(line) }, lines }
}

describe('property capability provisioning', () => {
  it('reports the capabilities a property is missing against its organization', async () => {
    const harness = deps({
      propertyCapabilities: { [PROPERTY_ID]: ['inbox.use'] },
    })

    const report = await harness.ops.report({
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
    })

    expect(report).toEqual({
      organizationId: ORG_ID,
      organizationCapabilities: [...ORG_CAPABILITIES],
      properties: [
        {
          propertyId: PROPERTY_ID,
          capabilities: ['inbox.use'],
          missing: ['reply.publish', 'review.sync'],
        },
      ],
    })
  })

  it('reports a freshly imported property as missing the whole organization set', async () => {
    const harness = deps()

    const report = await harness.ops.report({
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
    })

    expect(report.properties).toEqual([
      { propertyId: PROPERTY_ID, capabilities: [], missing: [...ORG_CAPABILITIES] },
    ])
  })

  it('refuses a property that belongs to another organization', async () => {
    const harness = deps()

    await expect(
      harness.ops.report({ organizationId: ORG_ID, propertyId: OTHER_PROPERTY_ID }),
    ).rejects.toThrow('property not found in organization')
    expect(harness.listPropertyCapabilities).not.toHaveBeenCalled()
  })

  it('targets every active property when no property is named', async () => {
    const harness = deps({
      provisionablePropertyIds: [PROPERTY_ID, OTHER_PROPERTY_ID],
      propertyCapabilities: { [OTHER_PROPERTY_ID]: [...ORG_CAPABILITIES] },
    })

    const report = await harness.ops.report({
      organizationId: ORG_ID,
      propertyId: null,
    })

    expect(harness.listProvisionablePropertyIds).toHaveBeenCalledWith(ORG_ID)
    expect(harness.getPropertyOrganizationId).not.toHaveBeenCalled()
    expect(report.properties.map((p) => p.missing)).toEqual([[...ORG_CAPABILITIES], []])
  })

  it('grants the missing capabilities and refreshes the policy snapshot once', async () => {
    const harness = deps({
      provisionablePropertyIds: [PROPERTY_ID, OTHER_PROPERTY_ID],
      propertyCapabilities: { [OTHER_PROPERTY_ID]: ['inbox.use'] },
    })

    const result = await harness.ops.sync({
      organizationId: ORG_ID,
      propertyId: null,
      createdBy: OPERATOR_ID,
    })

    expect(harness.provisionPropertyCapabilities).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      createdBy: OPERATOR_ID,
    })
    expect(result).toEqual({
      organizationId: ORG_ID,
      granted: [
        { propertyId: PROPERTY_ID, capabilities: [...ORG_CAPABILITIES] },
        {
          propertyId: OTHER_PROPERTY_ID,
          capabilities: ['reply.publish', 'review.sync'],
        },
      ],
    })
    expect(harness.refreshPolicy).toHaveBeenCalledOnce()
  })

  it('is idempotent: an already complete property grants nothing and refreshes nothing', async () => {
    const harness = deps({
      propertyCapabilities: { [PROPERTY_ID]: [...ORG_CAPABILITIES] },
    })

    const result = await harness.ops.sync({
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      createdBy: OPERATOR_ID,
    })

    expect(result.granted).toEqual([])
    expect(harness.refreshPolicy).not.toHaveBeenCalled()
  })

  it('provisions a created property with the initiating user as provenance', async () => {
    const harness = deps()

    await harness.ops.provisionCreatedProperty({
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      createdBy: 'user-7',
    })

    expect(harness.provisionPropertyCapabilities).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      createdBy: 'user-7',
    })
    // No tenant-scope read: the created property is provisioned by id.
    expect(harness.getPropertyOrganizationId).not.toHaveBeenCalled()
    expect(harness.refreshPolicy).toHaveBeenCalledOnce()
  })
})

describe('parsePropertyCapabilityCommand', () => {
  it('accepts a property-scoped list and sync', () => {
    expect(parsePropertyCapabilityCommand(['list', PROPERTY_ID], false)).toEqual({
      action: 'list',
      propertyId: PROPERTY_ID,
    })
    expect(parsePropertyCapabilityCommand(['sync', PROPERTY_ID], false)).toEqual({
      action: 'sync',
      propertyId: PROPERTY_ID,
    })
  })

  it('accepts --all without a property id', () => {
    expect(parsePropertyCapabilityCommand(['sync'], true)).toEqual({
      action: 'sync',
      propertyId: null,
    })
  })

  it('rejects a malformed invocation', () => {
    expect(parsePropertyCapabilityCommand([], false)).toBeNull()
    expect(parsePropertyCapabilityCommand(['revoke', PROPERTY_ID], false)).toBeNull()
    expect(parsePropertyCapabilityCommand(['sync'], false)).toBeNull()
    expect(parsePropertyCapabilityCommand(['sync', 'not-a-uuid'], false)).toBeNull()
    expect(parsePropertyCapabilityCommand(['sync', PROPERTY_ID], true)).toBeNull()
    expect(
      parsePropertyCapabilityCommand(['sync', PROPERTY_ID, 'extra'], false),
    ).toBeNull()
  })
})

describe('ops:property-capabilities action', () => {
  it('reports without writing when sync runs as a dry-run', async () => {
    const harness = deps()
    const { io, lines } = captureIO()
    const action = createPropertyCapabilityOperatorAction(
      harness.ops,
      { action: 'sync', propertyId: PROPERTY_ID },
      'ops:property-capabilities',
    )

    await action(
      { operatorId: OPERATOR_ID, organizationId: ORG_ID, dryRun: true },
      undefined,
      io,
    )

    expect(harness.provisionPropertyCapabilities).not.toHaveBeenCalled()
    expect(harness.refreshPolicy).not.toHaveBeenCalled()
    expect(JSON.parse(lines[0] as string)).toEqual({
      action: 'would_sync',
      organizationId: ORG_ID,
      organizationCapabilities: [...ORG_CAPABILITIES],
      properties: [
        { propertyId: PROPERTY_ID, capabilities: [], missing: [...ORG_CAPABILITIES] },
      ],
    })
    expect(lines[1]).toBe('re-run with --reason <text> --apply ops:property-capabilities')
  })

  it('grants on an applied sync', async () => {
    const harness = deps()
    const { io, lines } = captureIO()
    const action = createPropertyCapabilityOperatorAction(
      harness.ops,
      { action: 'sync', propertyId: PROPERTY_ID },
      'ops:property-capabilities',
    )

    await action(
      { operatorId: OPERATOR_ID, organizationId: ORG_ID, dryRun: false },
      undefined,
      io,
    )

    expect(harness.provisionPropertyCapabilities).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      createdBy: OPERATOR_ID,
    })
    expect(JSON.parse(lines[0] as string)).toEqual({
      action: 'sync',
      organizationId: ORG_ID,
      granted: [{ propertyId: PROPERTY_ID, capabilities: [...ORG_CAPABILITIES] }],
    })
  })

  it('never writes on list, even with --apply semantics', async () => {
    const harness = deps()
    const { io, lines } = captureIO()
    const action = createPropertyCapabilityOperatorAction(
      harness.ops,
      { action: 'list', propertyId: null },
      'ops:property-capabilities',
    )

    await action(
      { operatorId: OPERATOR_ID, organizationId: ORG_ID, dryRun: false },
      undefined,
      io,
    )

    expect(harness.provisionPropertyCapabilities).not.toHaveBeenCalled()
    expect(JSON.parse(lines[0] as string).action).toBe('list')
    expect(lines).toHaveLength(1)
  })
})
