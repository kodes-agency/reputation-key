import { describe, expect, it } from 'vitest'
import { linktreeDefaultTitle } from '#/contexts/portal/application/dto/portal-linktree.dto'
import { bgV2 } from './bg-v2'
import { deV2 } from './de-v2'
import { enV2 } from './en-v2'
import { esV2 } from './es-v2'
import { frV2 } from './fr-v2'
import { itV2 } from './it-v2'

// The editor shows a language's default Linktree title, and the legacy guest page
// prints it as a started category's heading; both come from a small map the
// portal context pins. It must stay the packs' own wording.
describe('the Linktree default title the editor pins', () => {
  it.each([
    ['en', enV2],
    ['bg', bgV2],
    ['es', esV2],
    ['it', itV2],
    ['fr', frV2],
    ['de', deV2],
  ] as const)('matches the %s pack', (locale, pack) => {
    expect(linktreeDefaultTitle(locale)).toBe(pack.copy.linktreeDefaultTitle)
  })
})
