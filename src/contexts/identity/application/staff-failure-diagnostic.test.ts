import { expect, it } from 'vitest'
import { staffFailureDiagnostic } from './staff-failure-diagnostic'
it('keeps the cause without names or addresses, including a partial name or different case', () => {
  const text = staffFailureDiagnostic(
    { email: 'polly@example.com', displayName: 'Polly Jones' },
    new Error(
      'POLLY: primary_text_missing for polly@example.com, jones or other@example.com',
    ),
  )
  expect(text).toContain('primary_text_missing')
  expect(text.toLowerCase()).not.toMatch(/polly|jones|@/)
})
