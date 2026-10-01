import { describe, expect, it, vi } from 'vitest'
import type { InboxCommandAuthority } from '../inbox-command-store'
import {
  createInboxCommandAuthority,
  type InboxCommandAuthorityAdapterDeps,
} from './inbox-command-authority.adapter'

const tx = {} as Parameters<InboxCommandAuthority>[0]
const at = new Date('2026-08-26T20:00:00.000Z')
type ManagerRequirement = Parameters<
  InboxCommandAuthorityAdapterDeps['decideManagerPropertyAuthorities']
>[1]['requirements'][number]

const allowEvery = (
  role: (userId: string) => 'AccountAdmin' | 'PropertyManager' = () => 'PropertyManager',
): InboxCommandAuthorityAdapterDeps['decideManagerPropertyAuthorities'] =>
  vi.fn(async (_tx, input) => ({
    allowed: true as const,
    decisions: input.requirements.map((requirement: ManagerRequirement) => ({
      userId: requirement.userId,
      propertyId: requirement.propertyId,
      role: role(requirement.userId),
      scope:
        role(requirement.userId) === 'AccountAdmin'
          ? ('organization' as const)
          : ('assigned-properties' as const),
    })),
  }))

describe('createInboxCommandAuthority', () => {
  it('authorizes the complete unique principal and Property set through one Identity batch', async () => {
    const decideManagerPropertyAuthorities = allowEvery((userId) =>
      userId === 'admin-z' ? 'AccountAdmin' : 'PropertyManager',
    )
    const authorize = createInboxCommandAuthority({ decideManagerPropertyAuthorities })

    await expect(
      authorize(tx, {
        organizationId: 'org-1',
        at,
        requirements: [
          {
            propertyId: 'property-b',
            userId: 'admin-z',
            permissions: ['inbox.write', 'review.read'],
            purpose: 'assignee',
          },
          {
            propertyId: 'property-a',
            userId: 'manager-a',
            permissions: ['inbox.write', 'review.read', 'inbox.manage'],
            purpose: 'actor',
          },
          {
            propertyId: 'property-a',
            userId: 'manager-a',
            permissions: ['inbox.write', 'review.read'],
            purpose: 'assignee',
          },
          {
            propertyId: 'property-b',
            userId: 'manager-a',
            permissions: ['inbox.write', 'feedback.handle'],
            purpose: 'actor',
          },
        ],
      }),
    ).resolves.toEqual({ allowed: true })

    expect(decideManagerPropertyAuthorities).toHaveBeenCalledOnce()
    expect(decideManagerPropertyAuthorities).toHaveBeenCalledWith(tx, {
      organizationId: 'org-1',
      at,
      requirements: [
        {
          propertyId: 'property-b',
          userId: 'admin-z',
          permissions: ['inbox.write', 'review.read'],
        },
        {
          propertyId: 'property-a',
          userId: 'manager-a',
          permissions: ['inbox.manage', 'inbox.write', 'review.read'],
        },
        {
          propertyId: 'property-b',
          userId: 'manager-a',
          permissions: ['feedback.handle', 'inbox.write'],
        },
      ],
    })
  })

  it('maps a batch denial to the purposes for the exact principal and Property', async () => {
    const authorize = createInboxCommandAuthority({
      decideManagerPropertyAuthorities: vi.fn(async () => ({
        allowed: false as const,
        userId: 'manager-a',
        propertyId: 'property-a',
        reason: 'assignment_denied',
      })),
    })

    await expect(
      authorize(tx, {
        organizationId: 'org-1',
        at,
        requirements: [
          {
            propertyId: 'property-a',
            userId: 'manager-a',
            permissions: ['inbox.write', 'feedback.handle'],
            purpose: 'actor',
          },
          {
            propertyId: 'property-a',
            userId: 'manager-a',
            permissions: ['inbox.write', 'feedback.handle'],
            purpose: 'assignee',
          },
        ],
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: 'actor_assignee_assignment_denied',
    })
  })

  it('allows a grant-scoped PropertyManager at every Property from the Identity decision alone', async () => {
    // The adapter has no Staff dependency at all: Identity's decision (active
    // membership, permission, current PropertyAccessGrant) is the whole answer.
    const decideManagerPropertyAuthorities = allowEvery()
    const authorize = createInboxCommandAuthority({ decideManagerPropertyAuthorities })

    await expect(
      authorize(tx, {
        organizationId: 'org-1',
        at,
        requirements: [
          {
            propertyId: 'property-a',
            userId: 'manager-a',
            permissions: ['inbox.write', 'review.read'],
            purpose: 'actor',
          },
          {
            propertyId: 'property-b',
            userId: 'manager-a',
            permissions: ['inbox.write', 'review.read'],
            purpose: 'actor',
          },
          {
            propertyId: 'property-a',
            userId: 'manager-b',
            permissions: ['inbox.write', 'review.read'],
            purpose: 'assignee',
          },
        ],
      }),
    ).resolves.toEqual({ allowed: true })
    expect(decideManagerPropertyAuthorities).toHaveBeenCalledOnce()
  })

  it('allows an empty requirement set without asking Identity', async () => {
    const decideManagerPropertyAuthorities = vi.fn()
    const authorize = createInboxCommandAuthority({ decideManagerPropertyAuthorities })

    await expect(
      authorize(tx, { organizationId: 'org-1', at, requirements: [] }),
    ).resolves.toEqual({ allowed: true })
    expect(decideManagerPropertyAuthorities).not.toHaveBeenCalled()
  })

  it('fails closed when Identity decides fewer requirements than were asked', async () => {
    const authorize = createInboxCommandAuthority({
      decideManagerPropertyAuthorities: vi.fn(async () => ({
        allowed: true as const,
        decisions: [
          {
            userId: 'manager-a',
            propertyId: 'property-a',
            role: 'PropertyManager' as const,
            scope: 'assigned-properties' as const,
          },
        ],
      })),
    })

    await expect(
      authorize(tx, {
        organizationId: 'org-1',
        at,
        requirements: [
          {
            propertyId: 'property-a',
            userId: 'manager-a',
            permissions: ['inbox.write'],
            purpose: 'actor',
          },
          {
            propertyId: 'property-b',
            userId: 'manager-a',
            permissions: ['inbox.write'],
            purpose: 'actor',
          },
        ],
      }),
    ).resolves.toEqual({ allowed: false, reason: 'authority_contract_mismatch' })
  })

  it('fails closed when Identity answers for a different principal than was asked', async () => {
    const authorize = createInboxCommandAuthority({
      decideManagerPropertyAuthorities: vi.fn(async () => ({
        allowed: true as const,
        decisions: [
          {
            userId: 'someone-else',
            propertyId: 'property-a',
            role: 'PropertyManager' as const,
            scope: 'assigned-properties' as const,
          },
        ],
      })),
    })

    await expect(
      authorize(tx, {
        organizationId: 'org-1',
        at,
        requirements: [
          {
            propertyId: 'property-a',
            userId: 'manager-a',
            permissions: ['inbox.write'],
            purpose: 'actor',
          },
        ],
      }),
    ).resolves.toEqual({ allowed: false, reason: 'authority_contract_mismatch' })
  })

  it('fails closed when a denial names a principal that was never asked about', async () => {
    const authorize = createInboxCommandAuthority({
      decideManagerPropertyAuthorities: vi.fn(async () => ({
        allowed: false as const,
        userId: 'stranger',
        propertyId: 'property-a',
        reason: 'membership_denied',
      })),
    })

    await expect(
      authorize(tx, {
        organizationId: 'org-1',
        at,
        requirements: [
          {
            propertyId: 'property-a',
            userId: 'manager-a',
            permissions: ['inbox.write'],
            purpose: 'actor',
          },
        ],
      }),
    ).resolves.toEqual({ allowed: false, reason: 'authority_contract_mismatch' })
  })
})
