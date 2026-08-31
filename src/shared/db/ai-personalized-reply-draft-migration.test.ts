import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const LEGACY_PERSONALIZED_REPLY_PROFILE_VERSION = 'reply-draft-v1'
const LEGACY_PERSONALIZED_REPLY_PROFILE_DIGEST =
  '86bb98cb3b0b1c8561141e2ec30e019725d5f0ba5dd57be4745c7db5bc851769'
const LEGACY_REPLY_OPERATION_PROFILE_DIGEST =
  '029203e3f20c86e3df3c54588eb51beb0dfb386affb0a5251707dd9ce9210bdc'

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/0153_ai-personalized-reply-draft.sql'),
  'utf8',
)
const runbook = readFileSync(
  resolve(process.cwd(), 'docs/operations/ai-personalized-reply-draft.md'),
  'utf8',
)

describe('AI personalized reply draft compatibility migration', () => {
  it('keeps historical template provenance valid while admitting only template-free v2 drafts', () => {
    expect(migration).toContain('DROP CONSTRAINT "replies_ai_provenance_valid"')
    expect(migration).toContain('"origin_ai_profile_version" = \'reply-suggestion-v1\'')
    expect(migration).toContain(
      `"origin_ai_profile_version" = '${LEGACY_PERSONALIZED_REPLY_PROFILE_VERSION}'`,
    )
    expect(migration).toContain('"origin_reply_template_catalogue_digest" IS NULL')
    expect(migration).toContain("\"origin_template_group\" IN ('en-Latn', 'bg-Cyrl')")
  })

  it('keeps the stable operation wrapper distinct from personalized draft freshness', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION "assert_current_ai_draft_binding_v1"',
    )
    expect(migration).toContain(
      'operation_row."operation_profile_version" = \'reply-suggestion-v1\'',
    )
    expect(migration).toContain(
      "reply_row.\"origin_ai_profile_version\" IN ('reply-suggestion-v1', 'reply-draft-v1')",
    )
  })

  it('pins readiness to the exact personalized profile without activating AI', () => {
    expect(migration).toContain(LEGACY_REPLY_OPERATION_PROFILE_DIGEST)
    expect(migration).toContain(LEGACY_PERSONALIZED_REPLY_PROFILE_DIGEST)
    expect(migration).not.toMatch(
      /UPDATE\s+"?(?:ai_global_control|ai_capability_controls|merchant_ai_enablement)"?/iu,
    )
  })

  it('documents a forward-only guarded restoration without rewriting history', () => {
    expect(runbook).toContain('Do not rewrite migration 0163')
    expect(runbook).toContain('no active grounded operations')
    expect(runbook).toMatch(/no pending grounded\s+suggestions/u)
    expect(runbook).toContain('new reviewed forward migration')
    expect(runbook).toMatch(/retain\s+all provenance\/freshness compatibility branches/u)
  })
})
