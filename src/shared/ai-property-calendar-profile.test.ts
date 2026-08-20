import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AI_PROPERTY_CALENDAR_PROFILE_V1 } from './ai-property-calendar-profile'

const migration0043 = readFileSync(
  resolve(process.cwd(), 'drizzle/0043_review-source-provenance.sql'),
  'utf8',
)
const migration0047 = readFileSync(
  resolve(process.cwd(), 'drizzle/0047_ai-derivatives-and-property-calendar.sql'),
  'utf8',
)
const migration0048 = readFileSync(
  resolve(process.cwd(), 'drizzle/0048_ai-lifecycle-authority.sql'),
  'utf8',
)
const adapter = readFileSync(
  resolve(
    process.cwd(),
    'src/contexts/ai/infrastructure/adapters/ai-property-calendar.adapter.ts',
  ),
  'utf8',
)

describe('property-calendar-v1 authority', () => {
  it('pins all three PostgreSQL functions, the database image, and exact vector corpus', () => {
    expect(AI_PROPERTY_CALENDAR_PROFILE_V1).toEqual({
      profileVersion: 'property-calendar-v1',
      epochMillisFunctionName: 'ai_epoch_millis_v1',
      epochMillisFunctionDigest:
        '9367a74304ab003cf57e2aa988883d72b4b9782a9cc9e7e639033c4b1604fa35',
      localDateFunctionName: 'ai_property_local_date_v1',
      localDateFunctionDigest:
        '6521dba5d8bc579bf55f8bf47d5db5c642032795949af54cb370189cac0d61a0',
      localMidnightFunctionName: 'ai_property_local_midnight_v1',
      localMidnightFunctionDigest:
        'ab121d8706ff847aea69b565d9571b3561e8289f0a417b8a35f13abb20edcbe1',
      databaseImageDigest:
        '33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20',
      vectorDigest: '0108713532775ad86be18c94c69eed42c9f2dfd24766608ff3592d87e7739545',
      vectorCount: 10,
      minimumYear: 1970,
      maximumYear: 2100,
      postgresMajorVersions: [16],
    })
    for (const value of Object.values(AI_PROPERTY_CALENDAR_PROFILE_V1)) {
      if (typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)) {
        expect(migration0048).toContain(`'${value}'`)
      }
    }
  })

  it('defines each function once in its owning unshipped migration and seals before use', () => {
    expect(
      migration0043.match(/CREATE OR REPLACE FUNCTION "ai_epoch_millis_v1"/g),
    ).toHaveLength(1)
    expect(
      migration0047.match(/CREATE OR REPLACE FUNCTION "ai_property_local_date_v1"/g),
    ).toHaveLength(1)
    expect(
      migration0048.match(/CREATE OR REPLACE FUNCTION "ai_property_local_midnight_v1"/g),
    ).toHaveLength(1)
    expect(migration0048).toContain('assert_ai_property_calendar_authority_v1()')
    expect(migration0048).toContain(
      "RAISE EXCEPTION 'property-calendar-v1 authority mismatch'",
    )
  })

  it('uses PostgreSQL numeric epoch reconstruction rather than a JavaScript Date authority', () => {
    expect(adapter).toContain(
      'to_timestamp(${input.reviewedAtEpochMillis}::numeric / 1000)',
    )
    expect(adapter).not.toContain('new Date(')
  })

  it('has a stable content-addressed runtime projection', () => {
    const digest = createHash('sha256')
      .update(JSON.stringify(AI_PROPERTY_CALENDAR_PROFILE_V1), 'utf8')
      .digest('hex')
    expect(digest).toMatch(/^[0-9a-f]{64}$/)
  })
})
