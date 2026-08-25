import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { compileGoogleProviderRequest } from '../../src/shared/google-provider-control/route-catalogue'
import { createPostgresGoogleAdmissionPermitAuthority } from './postgres-permit-authority'

const NOW = new Date('2026-08-25T12:00:00.000Z')
const PERMIT_ID = '8d000000-0000-4000-8000-000000000001'
const compiled = compileGoogleProviderRequest(
  {
    routeKey: 'account-management.accounts.list',
    accessToken: 'access-token',
  },
  () => 'a'.repeat(64),
)

const permitRow = {
  id: PERMIT_ID,
  capability: 'property.import_gbp_v2',
  route_key: compiled.routeKey,
  route_catalog_version: compiled.catalogueVersion,
  quota_policy_id: compiled.admission.quotaPolicyId,
  permit_generation: '1',
  policy_version: '7',
  emergency_kill_version: '3',
  approval_binding_id: '8a000000-0000-4000-8000-000000000001',
  authorization_vector: {
    requestBindingSha256: compiled.admission.requestBindingSha256,
    credentialBinding: compiled.admission.credentialBinding,
    projectFingerprint: 'b'.repeat(64),
    requestBodySha256: compiled.admission.requestBodySha256,
    requestBodyBytes: compiled.admission.requestBodyBytes,
  },
  state: 'admitted',
  start_deadline_at: new Date(NOW.getTime() + 30_000),
  organization_id: 'org-1',
  property_id: null,
  connection_id: '8e000000-0000-4000-8000-000000000001',
  initiator_user_id: 'user-1',
} as const

function authorityWith(startOutcome: 'started' | 'changed' | 'expired') {
  const query = vi.fn(async (text: string) => {
    if (text.includes('WITH candidate AS MATERIALIZED')) {
      return { rows: [{ outcome: startOutcome }], rowCount: 1 }
    }
    return { rows: [permitRow], rowCount: 1 }
  })
  const authority = createPostgresGoogleAdmissionPermitAuthority({
    pool: { query } as unknown as Pool,
    now: () => NOW,
    gatewayIdentity: 'spiffe://repkey.internal/google-egress-gateway',
  })
  return { authority, query }
}

describe('Postgres Google admission start boundary', () => {
  it('starts through one locked statement that rechecks live control and approval heads', async () => {
    const { authority, query } = authorityWith('started')
    const snapshot = await authority.load(PERMIT_ID)
    if (!snapshot) throw new Error('expected permit snapshot')

    await expect(authority.start(snapshot)).resolves.toBe('started')

    const startCall = query.mock.calls.find(([text]) =>
      text.includes('WITH candidate AS MATERIALIZED'),
    )
    expect(startCall).toBeDefined()
    const sql = startCall?.[0] ?? ''
    expect(sql).toContain('FOR UPDATE OF permit')
    expect(sql).toContain('policy_version AS policy')
    expect(sql).toContain('capability_execution_control AS control')
    expect(sql).toContain('capability_compliance_approvals AS approval')
    expect(sql).toContain("approval.status = 'approved'")
    expect(sql).toContain('approval.expires_at > $2')
    expect(sql).toContain('newer.binding_version > approval.binding_version')
    expect(sql).toContain("SET state = CASE WHEN candidate.outcome = 'started'")
  })

  it.each(['changed', 'expired'] as const)(
    'returns and preserves the database transition outcome: %s',
    async (outcome) => {
      const { authority } = authorityWith(outcome)
      const snapshot = await authority.load(PERMIT_ID)
      if (!snapshot) throw new Error('expected permit snapshot')

      await expect(authority.start(snapshot)).resolves.toBe(outcome)
    },
  )
})
