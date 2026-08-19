import type { KeyObject } from 'node:crypto'
import type { Reply } from '../../domain/types'
import type { OrganizationId, PropertyId, ReviewId, UserId } from '#/shared/domain/ids'

export type AiSuggestedDraftStoreInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewId: ReviewId
  actorUserId: UserId
  text: string
  provenanceToken: string
  now: Date
}>
export type AiSuggestedDraftBindingInput = Readonly<{
  organizationId: OrganizationId
  replyId: Reply['id']
}>

export type AiSuggestedDraftBindingResult = 'current' | 'not_ai' | 'stale'

export type AiSuggestedDraftRejection = 'invalid' | 'expired' | 'stale' | 'invalidated'

export type AiSuggestedDraftStoreResult =
  | Readonly<{ status: 'accepted'; reply: Reply }>
  | Readonly<{ status: 'rejected'; reason: AiSuggestedDraftRejection }>

export type AiSuggestedDraftStore = Readonly<{
  accept(input: AiSuggestedDraftStoreInput): Promise<AiSuggestedDraftStoreResult>
  assertCurrentBinding(
    input: AiSuggestedDraftBindingInput,
  ): Promise<AiSuggestedDraftBindingResult>
}>

export type AiReplyProvenancePublicKeyring = ReadonlyMap<string, KeyObject>
