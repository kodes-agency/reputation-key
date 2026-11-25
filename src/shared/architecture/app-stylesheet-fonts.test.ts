// The app stylesheet loads no third-party font, so a route can choose its own
// font set (src/shared/fonts/font-sets.ts) and no page makes a request to a font host;
// each web font in the theme stacks is followed by its size-adjusted fallback
// face, so text does not jump when the font arrives.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..', '..', '..')

describe('the app stylesheet', () => {
  it('no longer imports a third-party font, so a route can choose its own set', () => {
    const styles = readFileSync(join(ROOT, 'src/styles.css'), 'utf8')
    expect(styles).not.toMatch(/@import\s+url\(/)
    expect(styles).not.toContain('fontshare')
    expect(styles).not.toContain('fonts.googleapis')
  })

  it('follows each web font in the theme stacks with its size-adjusted fallback face', () => {
    const styles = readFileSync(join(ROOT, 'src/styles.css'), 'utf8')
    expect(styles).toMatch(
      /--font-sans:\s*'Plus Jakarta Sans',\s*'Plus Jakarta Sans Fallback',\s*system-ui,/,
    )
    expect(styles).not.toContain('Satoshi')
    expect(styles).toMatch(
      /--font-display:\s*'Plus Jakarta Sans',\s*'Plus Jakarta Sans Fallback',/,
    )
    expect(styles).toMatch(
      /--font-mono:\s*'JetBrains Mono',\s*'JetBrains Mono Fallback',/,
    )
  })
})
