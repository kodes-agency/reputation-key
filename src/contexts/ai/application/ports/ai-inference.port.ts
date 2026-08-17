import type {
  AiExecutionBindingV1,
  AnalysisResult,
  PropertyTrendGatewayRequestV1,
  ReplySuggestionGatewayRequestV1,
  ReplySuggestionResult,
  ReviewAnalysisGatewayRequestV1,
  TrendResult,
} from '#/shared/ai-gateway-transport-contract'

export type CommonAiSourceRequest = Readonly<{
  operationId: ReviewAnalysisGatewayRequestV1['operationId']
  permitId: ReviewAnalysisGatewayRequestV1['permitId']
  attemptNumber: ReviewAnalysisGatewayRequestV1['attemptNumber']
  organizationId: ReviewAnalysisGatewayRequestV1['organizationId']
  propertyId: ReviewAnalysisGatewayRequestV1['propertyId']
  internalSubjectId: ReviewAnalysisGatewayRequestV1['internalSubjectId']
  binding: AiExecutionBindingV1
  deadlineEpochMillis: number
}>

export type ReviewAnalysisSourceInput = ReviewAnalysisGatewayRequestV1
export type ReplySuggestionSourceInput = ReplySuggestionGatewayRequestV1
export type PropertyTrendSourceInput = PropertyTrendGatewayRequestV1

export type AiInferencePort = Readonly<{
  analyzeReview(
    input: ReviewAnalysisSourceInput,
    signal: AbortSignal,
  ): Promise<AnalysisResult>
  generateReply(
    input: ReplySuggestionSourceInput,
    signal: AbortSignal,
  ): Promise<ReplySuggestionResult>
  generateTrend(
    input: PropertyTrendSourceInput,
    signal: AbortSignal,
  ): Promise<TrendResult>
}>
