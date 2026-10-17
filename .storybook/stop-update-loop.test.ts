import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stopUpdateLoop } from './stop-update-loop'

/**
 * The text the installed React passes to console.error when an effect keeps
 * scheduling renders, read from React's own development build. The guard
 * matches on that wording, so a React upgrade that rewords it has to fail here,
 * where it is cheap, rather than quietly turn the guard off.
 */
function reactUpdateLoopWarning(): string {
  const reactDom = dirname(
    createRequire(import.meta.url).resolve('react-dom/package.json'),
  )
  const source = readFileSync(
    join(reactDom, 'cjs/react-dom-client.development.js'),
    'utf8',
  )
  const warning = /console\.error\(\s*"(Maximum update depth exceeded[^"]*)"/u.exec(
    source,
  )?.[1]
  if (warning === undefined) {
    throw new Error(
      'react-dom no longer logs "Maximum update depth exceeded" through console.error; ' +
        'point stopUpdateLoop at the new wording',
    )
  }
  return warning
}

describe('stopUpdateLoop', () => {
  it('throws React’s own message when an effect keeps re-rendering its component', () => {
    const warning = reactUpdateLoopWarning()

    expect(() => stopUpdateLoop([warning])).toThrow(warning)
  })

  it('reads the first argument, whatever React passes after it', () => {
    const warning = reactUpdateLoopWarning()

    expect(() => stopUpdateLoop([warning, '\n    at Counter'])).toThrow(warning)
  })

  it.each([
    [
      'an unrelated React warning',
      ['Each child in a list should have a unique "key" prop.'],
    ],
    [
      'a format string whose argument is an error',
      ['%o\n\n%s', new Error('boom'), 'stack'],
    ],
    ['an error object', [new Error('Maximum update depth exceeded')]],
    [
      'a message that only quotes the phrase',
      ['retry gave up: Maximum update depth exceeded'],
    ],
    ['an empty string', ['']],
    ['no arguments', []],
  ])('ignores %s', (_label, args) => {
    expect(() => stopUpdateLoop(args)).not.toThrow()
  })
})
