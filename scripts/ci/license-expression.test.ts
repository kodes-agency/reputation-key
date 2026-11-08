import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const { isAllowedExpression } = await import(
  pathToFileURL(resolve('scripts/license-expression.mjs')).href
)
const allowed = new Set(['MIT', 'ISC'])

describe('dependency license expressions', () => {
  it.each([
    ['MIT', true],
    ['GPL-3.0-only', false],
    ['MIT OR GPL-3.0-only', true],
    ['MIT AND GPL-3.0-only', false],
    ['MIT AND ISC', true],
    ['(MIT OR ISC) AND GPL-3.0-only', false],
    ['GPL-3.0-only AND (MIT OR ISC)', false],
    ['(GPL-3.0-only AND MIT) OR ISC', true],
    ['MIT OR ISC AND GPL-3.0-only', true],
    ['(MIT OR ISC) AND (GPL-3.0-only OR Apache-2.0)', false],
    ['(MIT OR GPL-3.0-only) AND (Apache-2.0 OR ISC)', true],
    ['((MIT AND ISC) OR GPL-3.0-only) AND MIT', true],
  ])('evaluates %s as %s', (expression, expected) => {
    expect(isAllowedExpression(expression, allowed)).toBe(expected)
  })

  it.each([
    '',
    '()',
    'MIT OR',
    'OR MIT',
    'MIT AND',
    'MIT ISC',
    '(MIT OR ISC',
    'MIT OR ISC)',
    'MIT / ISC',
    'MIT OR Unknown-License',
    'MIT WITH Unknown-Exception',
    'MIT OR ISC trailing',
  ])('rejects the whole malformed expression %j', (expression) => {
    expect(isAllowedExpression(expression, allowed)).toBe(false)
  })

  it('keeps a license exception attached to its license', () => {
    const expression = 'GPL-2.0-only WITH Classpath-exception-2.0'
    expect(
      isAllowedExpression(
        expression,
        new Set(['GPL-2.0-only', 'Classpath-exception-2.0']),
      ),
    ).toBe(false)
    expect(isAllowedExpression(expression, new Set([expression]))).toBe(true)
    expect(isAllowedExpression(`${expression} OR MIT`, allowed)).toBe(true)
    expect(isAllowedExpression(`${expression} AND MIT`, allowed)).toBe(false)
  })

  it('does not silently approve a later-version grant', () => {
    expect(isAllowedExpression('GPL-2.0+', new Set(['GPL-2.0']))).toBe(false)
    expect(isAllowedExpression('GPL-2.0+', new Set(['GPL-2.0+']))).toBe(true)
    expect(isAllowedExpression('MIT+', allowed)).toBe(false)
  })

  it('requires explicit approval of a custom license reference', () => {
    expect(isAllowedExpression('LicenseRef-Proprietary', allowed)).toBe(false)
    expect(
      isAllowedExpression('LicenseRef-Proprietary', new Set(['LicenseRef-Proprietary'])),
    ).toBe(true)
  })
})
