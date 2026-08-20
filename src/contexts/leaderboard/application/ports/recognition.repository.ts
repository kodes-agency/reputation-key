import type {
  RecognitionActivation,
  RecognitionActivationCommand,
  RecognitionBoardEntry,
} from '../../domain/governed-recognition'

export interface RecognitionSettings {
  readonly activation: RecognitionActivation | null
  readonly availablePortalGroups: readonly Readonly<{ id: string; name: string }>[]
  readonly availableMetrics: readonly Readonly<{
    definitionId: string
    definitionVersionId: string
    metricKey: string
    displayName: string
    aggregation: 'sum' | 'latest' | 'ratio'
    minimumSample: number
  }>[]
}

export interface RecognitionBoardView {
  readonly organizationId: string
  readonly propertyId: string
  readonly metricDefinitionVersionId: string
  readonly periodKind: 'weekly' | 'monthly' | 'quarterly'
  readonly periodStart: Date
  readonly periodEnd: Date
  readonly timezone: string
  readonly status: 'building' | 'ready' | 'stale' | 'insufficient' | 'corrected'
  readonly sourceWatermark: Date
  readonly correctionGeneration: number
  readonly entries: readonly RecognitionBoardEntry[]
  readonly employmentDecisionEligible: false
}

export interface RecognitionRepository {
  getSettings(organizationId: string, propertyId: string): Promise<RecognitionSettings>
  activate(
    command: Extract<RecognitionActivationCommand, { kind: 'activate' }>,
  ): Promise<RecognitionActivation>
  deactivate(
    input: Readonly<{
      organizationId: string
      propertyId: string
      actorId: string
      reason: string
      now: Date
    }>,
  ): Promise<RecognitionActivation>
  resolveVisiblePortalGroupIds(
    input: Readonly<{
      organizationId: string
      propertyId: string
      userId: string
      role: string
    }>,
  ): Promise<readonly string[]>
  getBoard(
    input: Readonly<{
      organizationId: string
      propertyId: string
      portalGroupId?: string
      visiblePortalGroupIds: readonly string[]
    }>,
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
  listActivePropertyScopes(): Promise<
    readonly Readonly<{
      organizationId: string
      propertyId: string
    }>[]
  >
}
