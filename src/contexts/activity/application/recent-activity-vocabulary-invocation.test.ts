import { describe, expect, it } from 'vitest'
import { parseRecentActivityVocabularyInvocation } from './recent-activity-vocabulary-invocation'

const FINGERPRINT = 'a'.repeat(64)
const OPERATION_ID = '00000000-0000-4000-8000-000000000001'

describe('parseRecentActivityVocabularyInvocation', () => {
  it('uses report mode when no reconciliation target is supplied', () => {
    expect(parseRecentActivityVocabularyInvocation([])).toEqual({ mode: 'report' })
  })

  it('parses one exact reviewed reconciliation target', () => {
    expect(
      parseRecentActivityVocabularyInvocation([
        'updated',
        'reply',
        'reply_updated',
        'review_reply',
        '12',
        FINGERPRINT,
        OPERATION_ID,
      ]),
    ).toEqual({
      mode: 'apply',
      source: { action: 'updated', resourceType: 'reply' },
      target: { action: 'reply_updated', resourceType: 'review_reply' },
      expectedTargetCount: 12,
      expectedTargetFingerprintSha256: FINGERPRINT,
      operationId: OPERATION_ID,
    })
  })

  it.each<string[]>([
    ['updated'],
    ['updated', 'reply', 'reply_updated', 'review_reply', '0', FINGERPRINT, OPERATION_ID],
    ['Updated', 'reply', 'reply_updated', 'review_reply', '1', FINGERPRINT, OPERATION_ID],
    ['updated', 'reply', 'reply_updated', 'review_reply', '1', 'bad', OPERATION_ID],
    ['updated', 'reply', 'reply_updated', 'review_reply', '1', FINGERPRINT, 'bad'],
  ])('rejects an incomplete or unsafe invocation (%j)', (...positionals) => {
    expect(() => parseRecentActivityVocabularyInvocation(positionals)).toThrow(
      'recent_activity_vocabulary_invocation_invalid',
    )
  })
})
