import { describe, expect, it } from 'vitest'
import { migrationEnvironment } from '../../../scripts/local-stack/google-import-release-drill'

describe('Google import release drill migrator environment', () => {
  it('provides only the sealed review-provider subject migrator key', () => {
    const environment = migrationEnvironment(
      'postgresql://release:secret@postgres:5432/repkey',
    )

    expect(environment).toContain(
      `REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS=local:${'ef'.repeat(32)}`,
    )
    expect(
      environment.some((value) => value.startsWith('REVIEW_PROVIDER_SUBJECT_HMAC_KEYS=')),
    ).toBe(false)
  })
})
