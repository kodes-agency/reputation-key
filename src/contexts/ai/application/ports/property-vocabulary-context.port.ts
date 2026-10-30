import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

/**
 * The one Property fact that chooses the vocabulary hints a review analysis is
 * steered with: the Google primary category stored at import and relink.
 * Hints are request context (`review-vocabulary-hints.ts`), so reading it moves
 * no fence: a category that changes reaches the next request and re-analyses
 * nothing.
 */
export type PropertyVocabularyContextPort = Readonly<{
  /**
   * The category in stored form, or null when the Property has none, is
   * archived or deleted, or does not exist. A missing category is a normal
   * state that selects the generic hints; the Property profile read that comes
   * before every request is what decides whether the Property may be analysed.
   */
  readGooglePrimaryCategory(
    input: Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>,
  ): Promise<string | null>
}>
