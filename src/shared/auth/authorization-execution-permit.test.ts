import { describe, expect, it } from 'vitest'
import {
  completeExecutionPermit,
  createAdmittedExecutionPermit,
  fenceExecutionPermit,
  startExecutionPermit,
} from './authorization-execution-permit'

const admittedAt = new Date('2026-08-10T10:00:00.000Z')

const createPermit = () =>
  createAdmittedExecutionPermit(
    {
      id: 'permit-1',
      capability: 'property.import_gbp_v2',
      organizationId: 'org-1',
      propertyId: null,
      connectionId: 'connection-1',
      initiatorUserId: 'user-1',
      operationKey: 'import.start',
      routeKey: 'google.business-information.locations.list',
      routeCatalogVersion: 'google-provider-routes-1',
      quotaPolicyId: 'gbp-business-information-interactive-1',
    },
    admittedAt,
  )

describe('authorization execution permit', () => {
  // WP2.2 removed `policy_version_changed`, `emergency_kill_changed`, and
  // `approval_binding_changed`; each only detected an unrelated write after admission.
  it('admits one attempt with a ten-second start deadline', () => {
    const permit = createPermit()

    expect(permit.state).toBe('admitted')
    // The fence must outlast the real web -> gateway -> admission path cost.
    expect(permit.startDeadlineAt).toEqual(new Date('2026-08-10T10:00:10.000Z'))
    expect(permit.startedAt).toBeNull()
    expect(permit.operationDeadlineAt).toBeNull()
  })

  it('starts immediately within the admitted start window', () => {
    const result = startExecutionPermit(createPermit(), {
      now: new Date('2026-08-10T10:00:00.500Z'),
    })

    expect(result.kind).toBe('started')
    if (result.kind !== 'started') return
    expect(result.permit.startedAt).toEqual(new Date('2026-08-10T10:00:00.500Z'))
    expect(result.permit.operationDeadlineAt).toEqual(
      new Date('2026-08-10T10:00:30.500Z'),
    )
  })

  it('fences an expired permit before protected access', () => {
    const expired = startExecutionPermit(createPermit(), {
      now: new Date('2026-08-10T10:00:10.000Z'),
    })
    expect(expired).toMatchObject({ kind: 'fenced', reason: 'start_deadline_elapsed' })
  })

  it('allows one started permit to complete and rejects a second transition', () => {
    const started = startExecutionPermit(createPermit(), {
      now: new Date('2026-08-10T10:00:00.500Z'),
    })
    if (started.kind !== 'started') throw new Error('expected started permit')

    const completed = completeExecutionPermit(
      started.permit,
      new Date('2026-08-10T10:00:10.000Z'),
    )
    expect(completed?.state).toBe('completed')
    expect(
      completeExecutionPermit(started.permit, new Date('2026-08-10T10:00:30.500Z')),
    ).toBeNull()
    expect(
      completeExecutionPermit(completed!, new Date('2026-08-10T10:00:11.000Z')),
    ).toBeNull()
    expect(
      fenceExecutionPermit(completed!, new Date('2026-08-10T10:00:11.000Z')),
    ).toBeNull()
  })
})
