import { sql } from 'drizzle-orm'
import type { AiBudgetTx } from './ai-budget'

type PropertyDraftScope = Readonly<{
  organizationId: string
  propertyId: string
}>

async function deletePropertyDrafts(
  tx: AiBudgetTx,
  input: PropertyDraftScope,
): Promise<void> {
  await tx.execute(sql`
    DELETE FROM replies AS reply
    USING reviews AS review
    WHERE reply.review_id = review.id
      AND reply.organization_id = review.organization_id
      AND review.property_id = ${input.propertyId}::uuid
      AND review.organization_id = ${input.organizationId}
      AND reply.authorship = 'ai_assisted'
      AND (reply.publication_state IS NULL OR reply.publication_state = 'authorized')
  `)
}

export function deleteAiDraftsForProperty(
  tx: AiBudgetTx,
  input: PropertyDraftScope,
): Promise<void> {
  return deletePropertyDrafts(tx, input)
}

export function deleteAiDraftsForProfile(
  tx: AiBudgetTx,
  input: PropertyDraftScope,
): Promise<void> {
  return deletePropertyDrafts(tx, input)
}

export function deleteAiDraftsForAuthorization(
  tx: AiBudgetTx,
  input: PropertyDraftScope,
): Promise<void> {
  return deletePropertyDrafts(tx, input)
}

export async function deleteAiDraftsForControl(
  tx: AiBudgetTx,
  scopeKind: 'global' | 'provider_deployment_profile' | 'capability',
  scopeValue: string | null,
): Promise<void> {
  if (
    scopeKind !== 'global' &&
    scopeKind !== 'provider_deployment_profile' &&
    !(scopeKind === 'capability' && scopeValue === 'reply_drafting')
  ) {
    return
  }
  await tx.execute(sql`
    DELETE FROM replies
    WHERE authorship = 'ai_assisted'
      AND (publication_state IS NULL OR publication_state = 'authorized')
  `)
}

export async function deleteAiDraftsForOrganization(
  tx: AiBudgetTx,
  organizationId: string,
): Promise<void> {
  await tx.execute(sql`
    DELETE FROM replies
    WHERE organization_id = ${organizationId}
      AND authorship = 'ai_assisted'
      AND (publication_state IS NULL OR publication_state = 'authorized')
  `)
}

export async function deleteAiDraftsForReview(
  tx: AiBudgetTx,
  input: Readonly<{ organizationId: string; reviewId: string }>,
): Promise<void> {
  await tx.execute(sql`
    DELETE FROM replies
    WHERE review_id = ${input.reviewId}::uuid
      AND organization_id = ${input.organizationId}
      AND authorship = 'ai_assisted'
      AND (publication_state IS NULL OR publication_state = 'authorized')
  `)
}
