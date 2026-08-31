import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AI_PERSONALIZED_REPLY_PROFILE_DIGEST,
  AI_PERSONALIZED_REPLY_PROFILE_VERSION,
} from '#/shared/ai-personalized-reply-contract'
import { getAiOperationProfile } from '#/shared/ai-operation-profiles'

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/0163_ai_reply_brand_profile_grounding.sql'),
  'utf8',
)

describe('AI Reply Brand Profile grounding migration', () => {
  it('adds an exact nullable legacy-or-grounded operation binding', () => {
    expect(migration).toContain('ADD COLUMN "reply_brand_profile_version" integer')
    expect(migration).toContain(
      'ADD COLUMN "reply_brand_display_name_digest" varchar(64)',
    )
    expect(migration).toContain('ai_operations_reply_brand_binding_valid')
    expect(migration).toContain(
      '"ai_operations"."command" <> \'reply\'\n    AND "ai_operations"."reply_brand_profile_version" IS NULL',
    )
  })

  it('keeps public Brand data behind one content-minimal Portal authority', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION "is_current_portal_ai_reply_brand_profile_v1"',
    )
    expect(migration).toContain("'repkey-ai-reply-brand-display-name-v1'")
    expect(migration).toContain("|| decode('00', 'hex')")
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION "is_current_portal_ai_reply_brand_profile_v1"',
    )
    expect(migration).not.toContain('logo_url')
    expect(migration).not.toContain('hero_image_url')
    expect(migration).not.toContain('primary_color')
  })

  it('retains immutable Brand provenance without retroactively fencing an adopted draft', () => {
    const assertionStart = migration.indexOf(
      'CREATE OR REPLACE FUNCTION "assert_current_ai_draft_binding_v1"',
    )
    const assertionEnd = migration.indexOf(
      'CREATE OR REPLACE FUNCTION "assert_ai_runtime_catalogue_ready_v1"',
    )
    const adoptedDraftAssertion = migration.slice(assertionStart, assertionEnd)
    expect(adoptedDraftAssertion).toContain(
      `reply_row."origin_ai_profile_version" = '${AI_PERSONALIZED_REPLY_PROFILE_VERSION}'`,
    )
    expect(adoptedDraftAssertion).toContain(
      "reply_row.\"origin_ai_profile_version\" IN ('reply-suggestion-v1', 'reply-draft-v1')",
    )
    expect(adoptedDraftAssertion).not.toContain(
      'is_current_portal_ai_reply_brand_profile_v1',
    )
  })

  it('makes admission compare and transactionally revalidate the exact Brand binding', () => {
    expect(migration).toContain(
      "'replyBrandProfileVersion', operation_row.reply_brand_profile_version",
    )
    expect(migration).toContain(
      "'replyBrandDisplayNameDigest',\n            operation_row.reply_brand_display_name_digest",
    )
    expect(migration).toContain('NOT public.is_current_portal_ai_reply_brand_profile_v1(')
  })

  it('repins the executable profile and leaves historical personalized drafts readable', () => {
    const profile = getAiOperationProfile('reply-suggestion-v1')
    expect(migration).toContain(
      `"personalizedReplyProfileDigest":"${AI_PERSONALIZED_REPLY_PROFILE_DIGEST}"`,
    )
    expect(migration).toContain(`"profile_digest":"${profile.profileDigest}"`)
    expect(migration).toContain(
      '"replies"."origin_ai_profile_version" IN (\'reply-draft-v1\', \'reply-draft-v2\')',
    )
  })
})
