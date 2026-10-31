import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const source = (path: string) => readFileSync(resolve('src', path), 'utf8')
describe('check-in presentation boundaries', () => {
  it('keeps clipboard generation isolated from words and server modules', () => {
    const summary = source(
      'components/features/property/guest-voice/guest-voice-team-summary.ts',
    )
    expect(summary).not.toMatch(/\.(?:text|quote|causes|title|answerName|inboxHref)\b/u)
    expect(summary).not.toContain('/server/')
    expect(summary).toContain('praiseReviews')
    expect(summary).toContain('complaintReviews')
  })
  it('uses shared sheet layout and safe-area actions, with no custom modal tree', () => {
    const sheet = source(
      'components/features/property/guest-voice/guest-voice-issue-drawer.tsx',
    )
    expect(sheet).toContain('layout={RESPONSIVE_DETAIL_SHEET}')
    expect(sheet).toContain('variant="safe-area-actions"')
    expect(sheet).not.toContain('fixed')
  })
})
