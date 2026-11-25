// The served reply-drafting execution a suggestion is adopted from: the
// operation columns a v4 provenance token binds to, and the frame reservation
// its adoption consumes.

import type { Database } from '#/shared/db'
import { replyAiFrameReservations } from '#/shared/db/schema'
import { REPLY_DRAFTING_V2_VERSIONS } from '#/shared/reply/schema'
import { REPLY_DRAFTING_V2_PROFILE_DIGEST } from '#/shared/reply/reply-drafting-v2-contract'
import { resolveReplyDraftingV2Options } from '#/shared/reply/request'
import type { ReplyVoiceChoices } from '#/shared/reply/reply-drafting-v2-binding'
import type { AiReplyProvenancePayload } from '#/shared/reply/ai-reply-provenance'

export const REPLY_V4_PROVIDER_PROFILE = 'private-beta-global-v3'
export const REPLY_V4_VOICE_DIGEST = 'f'.repeat(64)
export const REPLY_V4_CHOICES: ReplyVoiceChoices = {
  closing: -1,
  signOff: 1,
  contactSentence: 0,
  emoji: 0,
  includeContact: true,
}

/** A generation seed no other operation shares: the operation id, zero-padded. */
export function replyV4GenerationSeed(operationId: string): string {
  return operationId.replaceAll('-', '').padEnd(64, '0')
}

/** The operation columns the served v2 execution records. */
export function replyV4OperationColumns(operationId: string) {
  return {
    providerDeploymentProfileVersion: REPLY_V4_PROVIDER_PROFILE,
    operationProfileVersion: REPLY_DRAFTING_V2_VERSIONS.operation,
    capabilityRuntimeProfileVersion: REPLY_DRAFTING_V2_VERSIONS.runtime,
    replyTemplateCatalogueVersion: null,
    replyTemplateCatalogueDigest: null,
    replyDraftingV2: {
      options: resolveReplyDraftingV2Options({ languageCode: 'en-Latn', variation: 0 }),
      voiceDigest: REPLY_V4_VOICE_DIGEST,
      generationSeed: replyV4GenerationSeed(operationId),
      parentOperationId: null,
      rewriteOrdinal: 0 as const,
      rewriteIssues: [],
    },
  }
}

export async function insertReplyV4FrameReservation(
  db: Database,
  input: Readonly<{
    organizationId: string
    propertyId: string
    operationId: string
    createdAt: Date
  }>,
): Promise<void> {
  await db.insert(replyAiFrameReservations).values({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    languageGroup: 'en-Latn',
    ratingBand: 'positiveText',
    voiceDigest: REPLY_V4_VOICE_DIGEST,
    generationSeed: replyV4GenerationSeed(input.operationId),
    choices: REPLY_V4_CHOICES,
    closingOrder: [],
    createdAt: input.createdAt,
  })
}

/** The payload fields every v4 token of the served execution shares. */
export function replyV4TokenFields(operationId: string) {
  return {
    version: REPLY_DRAFTING_V2_VERSIONS.provenance,
    providerDeploymentProfileVersion: REPLY_V4_PROVIDER_PROFILE,
    operationProfileVersion: REPLY_DRAFTING_V2_VERSIONS.operation,
    modelSnapshot: 'gpt-6-luna',
    promptVersion: REPLY_DRAFTING_V2_VERSIONS.prompt,
    replyProfileVersion: REPLY_DRAFTING_V2_VERSIONS.profile,
    replyProfileDigest: REPLY_DRAFTING_V2_PROFILE_DIGEST,
    replyVoiceDigest: REPLY_V4_VOICE_DIGEST,
    voiceChoices: REPLY_V4_CHOICES,
    parentOperationId: null,
    rewriteOrdinal: 0,
    operationId,
  } as const satisfies Partial<AiReplyProvenancePayload>
}
