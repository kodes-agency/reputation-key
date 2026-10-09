// The header and title block's stylesheet: what is built from the hero's
// geometry, and how the wordmark is made to fit. Computed layout (that a long
// name really stays in the bar at 320 px) is in `guest-header.stories.tsx`.

import { describe, expect, it } from 'vitest'
import { IMMERSIVE_CHROME_CSS } from './immersive-chrome-styles'

const rule = (selector: string) =>
  IMMERSIVE_CHROME_CSS.match(
    new RegExp(`${selector.replaceAll('.', '\\.')}\\s*\\{([^}]*)\\}`, 'u'),
  )?.[1] ?? ''

describe('the wordmark', () => {
  it('is never cut off: no ellipsis and no clipping', () => {
    expect(IMMERSIVE_CHROME_CSS).not.toMatch(/text-overflow:\s*ellipsis/u)
    expect(rule('.ih-wordmark')).not.toMatch(/overflow:\s*hidden/u)
    expect(rule('.ih-wordmark')).not.toMatch(/white-space:\s*nowrap/u)
    // The last resort for a name too long for any size is a second line, broken
    // by the root's `overflow-wrap: break-word`, never hyphenated.
    expect(rule('.ih-wordmark')).not.toMatch(/overflow-wrap:\s*anywhere/u)
    expect(rule('.ih-wordmark')).toMatch(/hyphens:\s*manual/u)
  })

  it('is drawn at the board’s size and spacing until the room runs out', () => {
    expect(rule('.ih-wordmark')).toMatch(/font-size:\s*16px/u)
    expect(rule('.ih-wordmark')).toMatch(/letter-spacing:\s*0\.38em/u)
  })

  it('fits the room beside the chip: steps down to 11 px, then closes the spacing up', () => {
    expect(IMMERSIVE_CHROME_CSS).toMatch(/@supports \(width: 1cqw\)/u)
    expect(IMMERSIVE_CHROME_CSS).toMatch(/--ih-wm-size:\s*clamp\(11px,[^;]*,\s*16px\)/u)
    expect(IMMERSIVE_CHROME_CSS).toMatch(
      /letter-spacing:\s*clamp\(0\.4px,[^;]*,\s*0\.38em\)/u,
    )
    expect(IMMERSIVE_CHROME_CSS).toMatch(/container-type:\s*inline-size/u)
  })

  it('has more room where there is no chip', () => {
    expect(IMMERSIVE_CHROME_CSS).toMatch(
      /\.ih-header:not\(:has\(\.ih-chip\)\) \.ih-wordmark\s*\{\s*--ih-wm-reserve:\s*10px/u,
    )
    expect(rule('.ih-wordmark')).toMatch(/--ih-wm-reserve:\s*114px/u)
  })

  it('keeps the chip at the right even when there is no mark', () => {
    expect(rule('.ih-header')).toMatch(/justify-content:\s*flex-end/u)
    expect(rule('.ih-wordmark')).toMatch(/margin:\s*0 auto 0 0/u)
    expect(rule('.ih-logo')).toMatch(/margin-right:\s*auto/u)
  })
})

describe('the title block', () => {
  it('sits the hero’s height less 158 px below the header, so it keeps its place on a taller photo', () => {
    expect(rule('.ih-title')).toMatch(
      /margin-top:\s*calc\(var\(--ih-hero-h, 236px\) - 158px\)/u,
    )
  })

  it('draws the kicker in the accent on the field and in its photo-safe colour on a photo', () => {
    expect(rule('.ih-title__kicker')).toMatch(/color:\s*var\(--ih-accent-text\)/u)
    expect(IMMERSIVE_CHROME_CSS).toMatch(
      /\.ih-root\[data-ih-surface='photo'\] \.ih-title__kicker\s*\{\s*color:\s*var\(--ih-kicker-photo\)/u,
    )
  })
})
