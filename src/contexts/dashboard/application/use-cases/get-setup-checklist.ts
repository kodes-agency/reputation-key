import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'
import {
  isBetaInteractiveRole,
  requiresStaffParticipation,
  type BetaInteractiveRole,
} from '#/shared/domain/beta-interactive-role'
import { dashboardError } from '../../domain/errors'
import type {
  SetupChecklistFact,
  SetupChecklistRepository,
  SetupChecklistStepKey,
} from '../ports/setup-checklist.repository'

export type SetupChecklistActionKind =
  | 'manage_google'
  | 'import_property'
  | 'manage_property'
  | 'manage_portals'
  | 'assign_managers'

export type SetupChecklistAction = Readonly<{
  kind: SetupChecklistActionKind
  propertyId: PropertyId | null
}>

export type SetupChecklistStepStatus =
  'complete' | 'degraded' | 'incomplete' | 'waiting' | 'no_access'

export type SetupChecklistStep = Readonly<{
  key: SetupChecklistStepKey
  status: SetupChecklistStepStatus
  firstCompletedAt: Date | null
  action: SetupChecklistAction | null
}>

export type SetupChecklist = Readonly<{
  role: BetaInteractiveRole
  accessState: 'organization' | 'assigned' | 'no_access'
  state: 'complete' | 'in_progress' | 'waiting' | 'degraded' | 'no_access'
  steps: readonly SetupChecklistStep[]
}>

export type GetSetupChecklistInput = Readonly<{
  organizationId: OrganizationId
  role: Role
  accessiblePropertyIds: readonly PropertyId[] | null
  allowedActions: Readonly<{
    manageGoogle: boolean
    importProperty: boolean
    createPortal: boolean
    assignManagers: boolean
  }>
}>

export type GetSetupChecklistDeps = Readonly<{
  repository: SetupChecklistRepository
}>

type StepDefinition = Readonly<{
  key: SetupChecklistStepKey
  fact: SetupChecklistFact
  action: SetupChecklistAction | null
}>

function statusFor(
  role: BetaInteractiveRole,
  fact: SetupChecklistFact,
  action: SetupChecklistAction | null,
): SetupChecklistStepStatus {
  if (fact.currentlySatisfied) return 'complete'
  if (fact.firstCompletedAt !== null) return 'degraded'
  if (requiresStaffParticipation(role) && action === null) return 'waiting'
  return 'incomplete'
}

function overallState(steps: readonly SetupChecklistStep[]): SetupChecklist['state'] {
  if (steps.some((step) => step.status === 'degraded')) return 'degraded'
  if (steps.every((step) => step.status === 'complete')) return 'complete'
  if (steps.every((step) => step.status === 'complete' || step.status === 'waiting'))
    return 'waiting'
  return 'in_progress'
}

export const getSetupChecklist =
  (deps: GetSetupChecklistDeps) =>
  async (input: GetSetupChecklistInput): Promise<SetupChecklist> => {
    if (!isBetaInteractiveRole(input.role)) {
      throw dashboardError('forbidden', 'Setup checklist is unavailable for this role')
    }
    const role = input.role

    if (
      requiresStaffParticipation(role) &&
      input.accessiblePropertyIds !== null &&
      input.accessiblePropertyIds.length === 0
    ) {
      return {
        role,
        accessState: 'no_access',
        state: 'no_access',
        steps: (
          [
            'google_connection',
            'imported_property',
            'initial_review_sync',
            'published_portal',
            'responsible_managers',
          ] as const
        ).map((key) => ({
          key,
          status: 'no_access',
          firstCompletedAt: null,
          action: null,
        })),
      }
    }

    const facts = await deps.repository.readAndRecord({
      organizationId: input.organizationId,
      accessiblePropertyIds: input.accessiblePropertyIds,
    })
    const property = facts.anchorPropertyId
    const actions = input.allowedActions
    const definitions: readonly StepDefinition[] = [
      {
        key: 'google_connection',
        fact: facts.googleConnection,
        action: actions.manageGoogle ? { kind: 'manage_google', propertyId: null } : null,
      },
      {
        key: 'imported_property',
        fact: facts.importedProperty,
        action: actions.importProperty
          ? facts.importedProperty.firstCompletedAt !== null && property !== null
            ? { kind: 'manage_property', propertyId: property }
            : { kind: 'import_property', propertyId: null }
          : null,
      },
      {
        key: 'initial_review_sync',
        fact: facts.initialReviewSync,
        action: actions.manageGoogle
          ? { kind: 'manage_google', propertyId: property }
          : null,
      },
      {
        key: 'published_portal',
        fact: facts.publishedPortal,
        action:
          actions.createPortal && property !== null
            ? { kind: 'manage_portals', propertyId: property }
            : null,
      },
      {
        key: 'responsible_managers',
        fact: facts.responsibleManagers,
        action:
          actions.assignManagers && property !== null
            ? { kind: 'assign_managers', propertyId: property }
            : null,
      },
    ]

    const steps = definitions.map(({ key, fact, action }) => ({
      key,
      status: statusFor(role, fact, action),
      firstCompletedAt: fact.firstCompletedAt,
      action,
    }))

    return {
      role,
      accessState: requiresStaffParticipation(role) ? 'assigned' : 'organization',
      state: overallState(steps),
      steps,
    }
  }

export type GetSetupChecklist = ReturnType<typeof getSetupChecklist>
