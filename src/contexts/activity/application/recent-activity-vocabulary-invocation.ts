import { z } from 'zod/v4'

const vocabularyAtomSchema = z.string().regex(/^[a-z][a-z0-9_]{0,49}$/u)

const applyInvocationSchema = z.object({
  source: z.object({
    action: vocabularyAtomSchema,
    resourceType: vocabularyAtomSchema,
  }),
  target: z.object({
    action: vocabularyAtomSchema,
    resourceType: vocabularyAtomSchema,
  }),
  expectedTargetCount: z.number().int().positive(),
  expectedTargetFingerprintSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  operationId: z.uuid(),
})

export type RecentActivityVocabularyInvocation =
  | Readonly<{ mode: 'report' }>
  | (Readonly<{ mode: 'apply' }> & z.infer<typeof applyInvocationSchema>)

export function parseRecentActivityVocabularyInvocation(
  positionals: ReadonlyArray<string>,
): RecentActivityVocabularyInvocation {
  if (positionals.length === 0) return { mode: 'report' }
  if (positionals.length !== 7) {
    throw new Error('recent_activity_vocabulary_invocation_invalid')
  }

  const [
    sourceAction,
    sourceResourceType,
    targetAction,
    targetResourceType,
    expectedTargetCount,
    expectedTargetFingerprintSha256,
    operationId,
  ] = positionals
  const parsed = applyInvocationSchema.safeParse({
    source: { action: sourceAction, resourceType: sourceResourceType },
    target: { action: targetAction, resourceType: targetResourceType },
    expectedTargetCount: Number(expectedTargetCount),
    expectedTargetFingerprintSha256,
    operationId,
  })
  if (!parsed.success) {
    throw new Error('recent_activity_vocabulary_invocation_invalid')
  }
  return { mode: 'apply', ...parsed.data }
}
