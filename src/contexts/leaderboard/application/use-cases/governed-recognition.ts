import type {
  RecognitionBoardView,
  RecognitionRepository,
  RecognitionSettings,
} from '../ports/recognition.repository'
import type {
  RecognitionActivation,
  RecognitionActivationCommand,
} from '../../domain/governed-recognition'

export type RecognitionActor = Readonly<{
  organizationId: string
  userId: string
  role: string
}>

export type RecognitionActivationInput = Omit<
  Extract<RecognitionActivationCommand, { kind: 'activate' }>,
  'kind' | 'organizationId' | 'acknowledgedBy' | 'now'
>

export interface RecognitionUseCases {
  getSettings(actor: RecognitionActor, propertyId: string): Promise<RecognitionSettings>
  activate(
    actor: RecognitionActor,
    input: RecognitionActivationInput,
    now: Date,
  ): Promise<RecognitionActivation>
  deactivate(
    actor: RecognitionActor,
    input: Readonly<{ propertyId: string; reason: string }>,
    now: Date,
  ): Promise<RecognitionActivation>
  getBoard(
    actor: RecognitionActor,
    input: Readonly<{ propertyId: string; portalGroupId?: string }>,
  ): Promise<RecognitionBoardView | null>
  reconcileProperty(
    organizationId: string,
    propertyId: string,
  ): Promise<
    Readonly<{
      snapshotsReconciled: number
      entriesUpserted: number
      sourceFactsRecorded: number
    }>
  >
  listActiveScopes(): Promise<
    readonly Readonly<{
      organizationId: string
      propertyId: string
    }>[]
  >
  reconcileAll(): Promise<
    Readonly<{
      snapshotsReconciled: number
      entriesUpserted: number
      sourceFactsRecorded: number
    }>
  >
}

function requireManager(actor: RecognitionActor): void {
  if (actor.role !== 'AccountAdmin' && actor.role !== 'PropertyManager') {
    throw new Error('recognition_manager_required')
  }
}

export function createRecognitionUseCases(
  repo: RecognitionRepository,
): RecognitionUseCases {
  return {
    getSettings: async (actor: RecognitionActor, propertyId: string) => {
      requireManager(actor)
      return repo.getSettings(actor.organizationId, propertyId)
    },
    activate: async (
      actor: RecognitionActor,
      input: RecognitionActivationInput,
      now: Date,
    ) => {
      requireManager(actor)
      return repo.activate({
        ...input,
        kind: 'activate',
        organizationId: actor.organizationId,
        acknowledgedBy: actor.userId,
        now,
      })
    },
    deactivate: async (
      actor: RecognitionActor,
      input: Readonly<{ propertyId: string; reason: string }>,
      now: Date,
    ) => {
      requireManager(actor)
      return repo.deactivate({
        organizationId: actor.organizationId,
        propertyId: input.propertyId,
        actorId: actor.userId,
        reason: input.reason,
        now,
      })
    },
    getBoard: async (
      actor: RecognitionActor,
      input: Readonly<{ propertyId: string; portalGroupId?: string }>,
    ) => {
      const visiblePortalGroupIds = await repo.resolveVisiblePortalGroupIds({
        organizationId: actor.organizationId,
        propertyId: input.propertyId,
        userId: actor.userId,
        role: actor.role,
      })
      if (input.portalGroupId && !visiblePortalGroupIds.includes(input.portalGroupId)) {
        throw new Error('recognition_group_forbidden')
      }
      return repo.getBoard({
        organizationId: actor.organizationId,
        propertyId: input.propertyId,
        portalGroupId: input.portalGroupId,
        visiblePortalGroupIds,
      })
    },
    reconcileProperty: (organizationId: string, propertyId: string) =>
      repo.reconcileProperty(organizationId, propertyId),
    listActiveScopes: () => repo.listActivePropertyScopes(),
    reconcileAll: async () => {
      const scopes = await repo.listActivePropertyScopes()
      let snapshotsReconciled = 0
      let entriesUpserted = 0
      let sourceFactsRecorded = 0
      for (const scope of scopes) {
        const result = await repo.reconcileProperty(
          scope.organizationId,
          scope.propertyId,
        )
        snapshotsReconciled += result.snapshotsReconciled
        entriesUpserted += result.entriesUpserted
        sourceFactsRecorded += result.sourceFactsRecorded
      }
      return { snapshotsReconciled, entriesUpserted, sourceFactsRecorded }
    },
  }
}
