/** Advisory scalars only. Text and fingerprints never cross this boundary. */
export type DraftEditMetric = Readonly<{
  generationId: string | null
  replyId: string
  replyRevision: number
  distance: number | null
}>
export type DraftMeasurementEvent = Readonly<{
  generationId: string
  baseReplyRevision: number
  event: 'shown' | 'dismissed' | 'superseded' | 'draft' | 'try_again' | 'shorter' | 'tone'
}>
export type DraftGenerationMeasurement = Readonly<{
  organizationId: string
  propertyId: string
  reviewId: string
  actorUserId: string
  requestKey: string
  intent: 'explicit' | 'background'
  trigger: 'draft' | 'try_again' | 'shorter' | 'tone'
  contract: 'v1' | 'v2'
  outcome: 'ready' | 'refused'
  refusalCode: string | null
  case: string | null
  latencyMs: number
}>
