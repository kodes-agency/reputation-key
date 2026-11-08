import { describe, expect, it } from 'vitest'
import { linktreeDefaultTitle } from '#/contexts/portal/application/dto/portal-linktree.dto'
import { bgCopy } from './bg'
import { deCopy } from './de'
import { enCopy } from './en'
import { esCopy } from './es'
import { frCopy } from './fr'
import { itCopy } from './it'

// The editor shows a language's default Linktree title, and the legacy guest page
// prints it as a started category's heading; both come from a small map the
// portal context pins. It must stay the packs' own wording.
describe('the Linktree default title the editor pins', () => {
  it.each([
    ['en', enCopy],
    ['bg', bgCopy],
    ['es', esCopy],
    ['it', itCopy],
    ['fr', frCopy],
    ['de', deCopy],
  ] as const)('matches the %s pack', (locale, pack) => {
    expect(linktreeDefaultTitle(locale)).toBe(pack.copy.linktreeDefaultTitle)
  })
})
