import { describe, expect, it } from 'vitest'
import { IMMERSIVE_CHROME_CSS } from './immersive-chrome-styles'

describe('the wordmark fit', () => {
  // A browser that runs the stories supports container queries, so none can take the fallback path.
  it('is wrapped in a container-query check, steps down to 11 px and closes the spacing up', () => {
    expect(IMMERSIVE_CHROME_CSS).toMatch(/@supports \(width: 1cqw\)/u)
    expect(IMMERSIVE_CHROME_CSS).toMatch(/--ih-wm-size:\s*clamp\(11px,[^;]*,\s*16px\)/u)
    expect(IMMERSIVE_CHROME_CSS).toMatch(
      /letter-spacing:\s*clamp\(0\.4px,[^;]*,\s*0\.38em\)/u,
    )
  })
})
