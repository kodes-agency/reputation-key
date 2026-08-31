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

describe('createInboxCommandAuthority', () => {
  it('authorizes the complete unique principal and Property set through one Identity batch', async () => {
    const order: string[] = []
    const decideManagerPropertyAuthorities: InboxCommandAuthorityAdapterDeps['decideManagerPropertyAuthorities'] =
      vi.fn(async (_tx, input) => {
        order.push('identity-batch')
        return {
          allowed: true as const,
          decisions: input.requirements.map((requirement: ManagerRequirement) => ({
            userId: requirement.userId,
            propertyId: requirement.propertyId,
            role:
              requirement.userId === 'admin-z'
                ? ('AccountAdmin' as const)
                : ('PropertyManager' as const),
            scope:
              requirement.userId === 'admin-z'
                ? ('organization' as const)
                : ('assigned-properties' as const),
            requiresStaffParticipation: requirement.userId !== 'admin-z',
          })),
        }
      })
    const decideUserParticipationAuthority: InboxCommandAuthorityAdapterDeps['decideUserParticipationAuthority'] =
      vi.fn(async (_tx, input) => {
        order.push(`staff:${input.userId}:${input.propertyId}`)
        return {
          allowed: true,
          staffParticipantId: 'participant-1',
          staffParticipationId: 'participation-1',
        } as const
      })
    const authorize = createInboxCommandAuthority({
      decideManagerPropertyAuthorities,
      decideUserParticipationAuthority,
    })

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
    expect(order).toEqual([
      'identity-batch',
      'staff:manager-a:property-a',
      'staff:manager-a:property-b',
    ])
  })

  it('maps a batch denial to the purposes for the exact principal and Property', async () => {
    const decideUserParticipationAuthority = vi.fn()
    const authorize = createInboxCommandAuthority({
      decideManagerPropertyAuthorities: vi.fn(async () => ({
        allowed: false as const,
        userId: 'manager-a',
        propertyId: 'property-a',
        reason: 'assignment_denied',
      })),
      decideUserParticipationAuthority,
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
    expect(decideUserParticipationAuthority).not.toHaveBeenCalled()
  })

  it('fails closed when an otherwise eligible PropertyManager lacks participation at one Property', async () => {
    const authorize = createInboxCommandAuthority({
      decideManagerPropertyAuthorities: vi.fn(async (_tx, input) => ({
        allowed: true as const,
        decisions: input.requirements.map((requirement: ManagerRequirement) => ({
          ...requirement,
          role: 'PropertyManager' as const,
          scope: 'assigned-properties' as const,
          requiresStaffParticipation: true,
        })),
      })),
      decideUserParticipationAuthority: vi.fn(async (_tx, input) =>
        input.propertyId === 'property-b'
          ? ({ allowed: false as const, reason: 'participation_denied' } as const)
          : ({
              allowed: true as const,
              staffParticipantId: 'participant-1',
              staffParticipationId: 'participation-1',
            } as const),
      ),
    })

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
        ],
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: 'actor_participation_denied',
    })
  })
})
