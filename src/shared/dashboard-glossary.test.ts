import { describe, expect, it } from 'vitest'
import { DASHBOARD_GLOSSARY } from './dashboard-glossary'

const entries = Object.entries(DASHBOARD_GLOSSARY)

/**
 * The glossary exists because the survey found the read model's vocabulary
 * rendered straight to merchants. A definition that reintroduces that
 * vocabulary defeats the point, so the rule is enforced rather than remembered.
 */
describe('dashboard glossary definitions', () => {
  it('never explains a term with the jargon it replaces', () => {
    // `aspect` and `weighted impact` are the read model's words for topic and
    // impact; `aspect-impact-v1` is the version id that used to appear in an
    // 11 px footnote under the figure it was meant to explain.
    const banned = [
      /aspect/i,
      /weighted impact/i,
      /-v\d/i,
      /star-only/i,
      /eligible/i,
      /governed/i,
      /provisional/i,
    ]

    for (const [key, entry] of entries) {
      for (const pattern of banned) {
        expect(
          entry.definition,
          `${key} definition matches banned ${String(pattern)}`,
        ).not.toMatch(pattern)
      }
    }
  })

  it('defines each term in prose a merchant can read, not a fragment', () => {
    for (const [key, entry] of entries) {
      expect(entry.term, `${key} has a term`).not.toBe('')
      // One or two sentences: long enough to say what counts, short enough for
      // a popover. The survey's failure mode was the opposite of both — a
      // one-word label with its meaning in a footnote elsewhere.
      expect(entry.definition.length, `${key} definition is too short`).toBeGreaterThan(
        40,
      )
      expect(entry.definition.length, `${key} definition is too long`).toBeLessThan(320)
      expect(entry.definition.trimEnd(), `${key} definition ends in a full stop`).toMatch(
        /\.$/,
      )
    }
  })
})
