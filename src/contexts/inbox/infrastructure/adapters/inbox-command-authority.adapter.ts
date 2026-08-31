import type { Permission } from '#/shared/domain/permissions'
import type {
  InboxCommandAuthority,
  InboxCommandAuthorityRequirement,
} from '../inbox-command-store'

type AuthorityTransaction = Parameters<InboxCommandAuthority>[0]

type ManagerDecision = Readonly<{
  propertyId: string
  userId: string
  role: 'AccountAdmin' | 'PropertyManager'
  scope: 'organization' | 'assigned-properties'
  requiresStaffParticipation: boolean
}>

type ManagerBatchDecision =
  | Readonly<{ allowed: true; decisions: readonly ManagerDecision[] }>
  | Readonly<{
      allowed: false
      propertyId: string
      userId: string
      reason: string
    }>

type ParticipationDecision =
  | Readonly<{
      allowed: true
      staffParticipantId: string
      staffParticipationId: string
    }>
  | Readonly<{ allowed: false; reason: string }>

export type InboxCommandAuthorityAdapterDeps = Readonly<{
  decideManagerPropertyAuthorities: (
    tx: AuthorityTransaction,
    input: Readonly<{
      organizationId: string
      requirements: readonly Readonly<{
        propertyId: string
        userId: string
        permissions: readonly Permission[]
      }>[]
      at: Date
    }>,
  ) => Promise<ManagerBatchDecision>
  decideUserParticipationAuthority: (
    tx: AuthorityTransaction,
    input: Readonly<{
      organizationId: string
      propertyId: string
      userId: string
      at: Date
    }>,
  ) => Promise<ParticipationDecision>
}>

type MergedRequirement = Readonly<{
  propertyId: string
  userId: string
  permissions: readonly Permission[]
  purposes: readonly InboxCommandAuthorityRequirement['purpose'][]
}>

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

const requirementKey = (userId: string, propertyId: string): string =>
  `${userId}\u0000${propertyId}`

const compareRequirements = (
  left: Pick<MergedRequirement, 'propertyId' | 'userId'>,
  right: Pick<MergedRequirement, 'propertyId' | 'userId'>,
): number =>
  compareText(left.userId, right.userId) || compareText(left.propertyId, right.propertyId)

const mergeRequirements = (
  requirements: readonly InboxCommandAuthorityRequirement[],
): readonly MergedRequirement[] => {
  const merged = new Map<
    string,
    {
      propertyId: string
      userId: string
      permissions: Set<Permission>
      purposes: Set<InboxCommandAuthorityRequirement['purpose']>
    }
  >()
  for (const requirement of requirements) {
    const key = requirementKey(requirement.userId, requirement.propertyId)
    const current = merged.get(key) ?? {
      propertyId: requirement.propertyId,
      userId: requirement.userId,
      permissions: new Set<Permission>(),
      purposes: new Set<InboxCommandAuthorityRequirement['purpose']>(),
    }
    for (const permission of requirement.permissions) {
      current.permissions.add(permission)
    }
    current.purposes.add(requirement.purpose)
    merged.set(key, current)
  }
  return [...merged.values()]
    .map((value) => ({
      propertyId: value.propertyId,
      userId: value.userId,
      permissions: [...value.permissions].sort(compareText),
      purposes: [...value.purposes].sort(compareText),
    }))
    .sort(compareRequirements)
}

const purposeFor = (requirement: MergedRequirement): string =>
  requirement.purposes.join('_')

/**
 * Compose Identity's command-wide manager/grant proof with Staff's exact
 * participation proof. Identity receives every unique principal/Property
 * requirement in one call, so permission_version is never locked between two
 * concrete authority rows. Staff proofs then run in the same stable tuple
 * order. AccountAdmins intentionally do not require a Staff row.
 */
export const createInboxCommandAuthority =
  (deps: InboxCommandAuthorityAdapterDeps): InboxCommandAuthority =>
  async (tx, input) => {
    const requirements = mergeRequirements(input.requirements)
    if (requirements.length === 0) return { allowed: true }

    const identityDecision = await deps.decideManagerPropertyAuthorities(tx, {
      organizationId: input.organizationId,
      at: input.at,
      requirements: requirements.map(({ propertyId, userId, permissions }) => ({
        propertyId,
        userId,
        permissions,
      })),
    })
    if (!identityDecision.allowed) {
      const requirement = requirements.find(
        (candidate) =>
          candidate.userId === identityDecision.userId &&
          candidate.propertyId === identityDecision.propertyId,
      )
      return {
        allowed: false,
        reason: requirement
          ? `${purposeFor(requirement)}_${identityDecision.reason}`
          : 'authority_contract_mismatch',
      }
    }

    const decisions = new Map(
      identityDecision.decisions.map((decision) => [
        requirementKey(decision.userId, decision.propertyId),
        decision,
      ]),
    )
    if (decisions.size !== requirements.length) {
      return { allowed: false, reason: 'authority_contract_mismatch' }
    }

    for (const requirement of requirements) {
      const identity = decisions.get(
        requirementKey(requirement.userId, requirement.propertyId),
      )
      if (!identity) return { allowed: false, reason: 'authority_contract_mismatch' }
      if (!identity.requiresStaffParticipation) continue

      const staffDecision = await deps.decideUserParticipationAuthority(tx, {
        organizationId: input.organizationId,
        propertyId: requirement.propertyId,
        userId: requirement.userId,
        at: input.at,
      })
      if (!staffDecision.allowed) {
        return {
          allowed: false,
          reason: `${purposeFor(requirement)}_${staffDecision.reason}`,
        }
      }
    }
    return { allowed: true }
  }
