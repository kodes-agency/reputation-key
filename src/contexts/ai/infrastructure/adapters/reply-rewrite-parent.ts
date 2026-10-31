import { isReplyDraftingV2Binding } from '#/shared/domain/reply-drafting-v2'
import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { aiOperations } from '#/shared/db/schema'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import { aiRequestFingerprint } from '../../application/ai-workflow-support'
import type { AiOperationStorePort } from '../../application/ports/ai-operation-store.port'
import type { AiOperationBinding, AiOperationIdentity } from '../../domain/types'
type OperationRow = typeof aiOperations.$inferSelect
type ClaimInput = Parameters<AiOperationStorePort['claim']>[0]
type ParentReaders = Readonly<{
  parseIdentity(row: OperationRow): AiOperationIdentity
  parseBinding(row: OperationRow, identity: AiOperationIdentity): AiOperationBinding
}>
/** The unique parent index and row lock make concurrent rewrites one durable operation. */
export async function invalidReplyRewriteParent(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  input: ClaimInput,
  readers: ParentReaders,
): Promise<OperationRow | null> {
  const rewrite = input.binding.replyDraftingV2
  if (!rewrite?.parentOperationId) return null
  const [parent] = await tx
    .select()
    .from(aiOperations)
    .where(
      and(
        eq(aiOperations.id, rewrite.parentOperationId),
        eq(aiOperations.organizationId, input.identity.organizationId),
        eq(aiOperations.propertyId, input.identity.propertyId),
      ),
    )
    .for('update')
  if (!parent) throw new Error('AI reply rewrite parent is missing')
  if (!validReplyRewriteParent(parent, input, readers)) return parent
  return null
}

function validReplyRewriteParent(
  parent: OperationRow,
  input: ClaimInput,
  readers: ParentReaders,
): boolean {
  const rewrite = input.binding.replyDraftingV2!
  const parentBinding = parent.replyDraftingV2
  if (
    !parentBinding ||
    parentBinding.rewriteOrdinal !== 0 ||
    parent.rewriteParentOperationId !== null
  )
    return false
  if (
    parent.state !== 'failed' ||
    parent.failureCode !== 'output_invalid' ||
    parent.budgetSettledAt === null ||
    parent.actualMicros === null
  )
    return false
  const expectedKey = aiRequestFingerprint({
    parentOperationId: parent.id,
    rewriteOrdinal: 1,
  })
  return (
    input.idempotencyKey === expectedKey &&
    canonicalizeRfc8785(readers.parseIdentity(parent)) ===
      canonicalizeRfc8785(input.identity) &&
    parent.sourceDigest === input.sourceProvenance?.digest &&
    parent.sourceByteCount === input.sourceProvenance.byteCount &&
    canonicalizeRfc8785(parentBinding.options) === canonicalizeRfc8785(rewrite.options) &&
    parentBinding.voiceDigest === rewrite.voiceDigest &&
    canonicalizeRfc8785(withoutReplyV2(readers.parseBinding(parent, input.identity))) ===
      canonicalizeRfc8785(withoutReplyV2(input.binding))
  )
}

function withoutReplyV2(binding: AiOperationBinding) {
  const { replyDraftingV2: _replyDraftingV2, ...common } = binding
  return common
}

export function replyV2InsertionValues(binding: AiOperationBinding) {
  if (
    binding.operationProfileVersion === 'reply-suggestion-v2' &&
    !isReplyDraftingV2Binding(binding.replyDraftingV2)
  )
    throw new TypeError('Invalid reply drafting metadata')
  return {
    replyDraftingV2: binding.replyDraftingV2 ?? null,
    rewriteParentOperationId: binding.replyDraftingV2?.parentOperationId ?? null,
  }
}
