import { sql } from 'drizzle-orm'
import { check, type AnyPgColumn } from 'drizzle-orm/pg-core'

export function repliesAiProvenanceValid(
  t: Readonly<
    Record<
      | 'aiDraftExpiresAt'
      | 'authorship'
      | 'originAiProfileVersion'
      | 'originBaseReplyStateRevision'
      | 'originConcreteLanguageTag'
      | 'originOperationId'
      | 'originPropertyProfileVersion'
      | 'originReplyDraftingEpoch'
      | 'originReplyTemplateCatalogueDigest'
      | 'originReplyTemplateCatalogueVersion'
      | 'originReplyTemplateId'
      | 'originSourceEpoch'
      | 'originSourceRevision'
      | 'originTemplateGroup',
      AnyPgColumn
    >
  >,
) {
  return check(
    'replies_ai_provenance_valid',
    sql`(
        (
          ${t.authorship} = 'ai_assisted'
          AND ${t.originOperationId} IS NOT NULL
          AND ${t.originSourceEpoch} >= 0
          AND ${t.originSourceRevision} >= 1
          AND ${t.originBaseReplyStateRevision} BETWEEN 0 AND '9007199254740991'::bigint
          AND ${t.originReplyDraftingEpoch} >= 1
          AND ${t.originPropertyProfileVersion} >= 1
          AND (
            (
              ${t.originAiProfileVersion} = 'reply-suggestion-v1'
              AND ${t.originReplyTemplateId} IN (
                'appreciation_positive',
                'appreciation_neutral',
                'recovery_service',
                'acknowledge_concern'
              )
              AND ${t.originReplyTemplateCatalogueVersion} = 'gbp-reply-template-catalogue-v1'
              AND ${t.originReplyTemplateCatalogueDigest} = 'ff5f572e9c8ce06fc384bdc4cdd911457510fdd0daed571a53d2348faa8bd89f'
            )
            OR (
              ${t.originAiProfileVersion} IN ('reply-draft-v1', 'reply-draft-v2', 'reply-draft-v3')
              AND ${t.originReplyTemplateId} IS NULL
              AND ${t.originReplyTemplateCatalogueVersion} IS NULL
              AND ${t.originReplyTemplateCatalogueDigest} IS NULL
              AND ${t.originTemplateGroup} IN ('en-Latn', 'bg-Cyrl')
            )
            OR (
              ${t.originAiProfileVersion} = 'reply-draft-v4'
              AND ${t.originReplyTemplateId} IS NULL
              AND ${t.originReplyTemplateCatalogueVersion} IS NULL
              AND ${t.originReplyTemplateCatalogueDigest} IS NULL
              AND ${t.originTemplateGroup} IN ('en-Latn', 'es-Latn', 'bg-Cyrl')
            )
          )
          AND ${t.originTemplateGroup} IN (
            'en-Latn', 'es-Latn', 'fr-Latn', 'de-Latn', 'pt-Latn',
            'it-Latn', 'nl-Latn', 'pl-Latn', 'tr-Latn', 'uk-Cyrl',
            'ru-Cyrl', 'ar-Arab', 'he-Hebr', 'hi-Deva', 'bn-Beng',
            'ta-Taml', 'th-Thai', 'vi-Latn', 'id-Latn', 'zh-Hans',
            'zh-Hant', 'ja-Jpan', 'ko-Kore', 'bg-Cyrl'
          )
          AND (
            ${t.originConcreteLanguageTag} = ${t.originTemplateGroup}
            OR ${t.originConcreteLanguageTag} ~~ (${t.originTemplateGroup} || '-%')
          )
          AND ${t.aiDraftExpiresAt} IS NOT NULL
        )
        OR (
          ${t.originOperationId} IS NULL
          AND ${t.originSourceEpoch} IS NULL
          AND ${t.originSourceRevision} IS NULL
          AND ${t.originBaseReplyStateRevision} IS NULL
          AND ${t.originReplyDraftingEpoch} IS NULL
          AND ${t.originPropertyProfileVersion} IS NULL
          AND ${t.originAiProfileVersion} IS NULL
          AND ${t.originReplyTemplateId} IS NULL
          AND ${t.originReplyTemplateCatalogueVersion} IS NULL
          AND ${t.originReplyTemplateCatalogueDigest} IS NULL
          AND ${t.originConcreteLanguageTag} IS NULL
          AND ${t.originTemplateGroup} IS NULL
          AND ${t.aiDraftExpiresAt} IS NULL
        )
      )`,
  )
}
