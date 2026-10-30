import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { properties } from '#/shared/db/schema'
import { normalizeGooglePrimaryCategory } from '#/shared/domain/google-primary-category'
import type { PropertyVocabularyContextPort } from '../../application/ports/property-vocabulary-context.port'

export const createPropertyVocabularyContextAdapter = (
  db: Database,
): PropertyVocabularyContextPort => ({
  async readGooglePrimaryCategory(input) {
    const [row] = await db
      .select({ category: properties.googlePrimaryCategory })
      .from(properties)
      .where(
        and(
          eq(properties.organizationId, input.organizationId),
          eq(properties.id, input.propertyId),
          isNull(properties.deletedAt),
        ),
      )
      .limit(1)
    // The column is held to stored form by a CHECK; reading it through the same
    // function makes the request's category correct even for a row it did not see.
    return normalizeGooglePrimaryCategory(row?.category)
  },
})
