import { describe, expect, it } from 'vitest'
import { balanceWords, fillWords } from './portal-print-kit-text'

const byLength = (text: string) => text.length

describe('balanceWords', () => {
  it('keeps a text that fits on one line', () => {
    expect(balanceWords('Pool & Terrace', 30, byLength)).toEqual(['Pool & Terrace'])
  })

  it('evens out the lines it needs instead of leaving a stub', () => {
    // Greedy at 24: "Spa & Wellness Centre" over "Lobby".
    expect(balanceWords('Spa & Wellness Centre Lobby', 24, byLength)).toEqual([
      'Spa & Wellness',
      'Centre Lobby',
    ])
  })

  it('keeps the number of lines greedy needs, three when it takes three', () => {
    const lines = balanceWords('one two three four five six seven eight', 14, byLength)
    expect(lines).toHaveLength(3)
    expect(Math.max(...lines.map(byLength))).toBeLessThanOrEqual(14)
  })

  it('returns no lines for blank text', () => {
    expect(balanceWords('  ', 10, byLength)).toEqual([])
  })

  it('never breaks at a no-break space, so a French question mark stays with its word', () => {
    // Narrower than "Votre avis sur nous ?": the break falls before "nous ?", never before "?".
    const lines = balanceWords('Votre avis sur nous\u00a0?', 14, byLength)
    expect(lines).toEqual(['Votre avis', 'sur nous\u00a0?'])
    expect(balanceWords('Merci\u202f!', 3, byLength)).toEqual(['Merci\u202f!'])
  })

  it('breaks after a hyphen between letters only when asked, keeping the hyphen on the first line', () => {
    const text = 'Harborline Inn Houston-Near The Galleria'
    expect(balanceWords(text, 30, byLength, 'spaces-and-hyphens')).toEqual([
      'Harborline Inn Houston-',
      'Near The Galleria',
    ])
    expect(balanceWords(text, 30, byLength)).not.toContain('Harborline Inn Houston-')
    // A dash standing alone, or a hyphen at a word's edge, is no break.
    expect(fillWords('Spa - Pool -Bar', 3, byLength, 'spaces-and-hyphens')).toEqual([
      'Spa',
      '-',
      'Pool',
      '-Bar',
    ])
  })
})
