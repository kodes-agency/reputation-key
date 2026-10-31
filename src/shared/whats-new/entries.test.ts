import { existsSync } from 'node:fs'
import { icons } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { PRODUCT_UPDATES } from './entries'
import { PRODUCT_UPDATE_ICONS, PRODUCT_UPDATE_ROUTES, type ProductUpdate } from './types'
import { productUpdateCopyProblems } from './copy-check'

const entry: ProductUpdate = {
  id: '2026-10-31-example',
  publishedOn: '2026-10-31',
  kind: 'highlight',
  audience: 'everyone',
  title: 'Clearer replies',
  body: 'Make every guest feel welcome.',
  icon: 'Check',
}

describe('manager update copy', () => {
  it('keeps every published entry readable', () =>
    expect(productUpdateCopyProblems(PRODUCT_UPDATES)).toEqual([]))
  it.each(
    'deploy deployment release build model prompt schema migration database api endpoint cache token sha commit pr pull_request refactor backend frontend server latency bug flag epoch runtime json sql sentry railway codex claude'.split(
      ' ',
    ),
  )('rejects the technical word %s in either field', (word) => {
    const title = word.replace('_', ' ').toUpperCase()
    expect(productUpdateCopyProblems([{ ...entry, title }])).toContain(
      `${entry.id}: technical copy`,
    )
    expect(productUpdateCopyProblems([{ ...entry, body: title }])).toContain(
      `${entry.id}: technical copy`,
    )
  })
  it('matches whole words, leaving ordinary manager language alone', () =>
    expect(
      productUpdateCopyProblems([
        { ...entry, body: 'The garden blooms again. Priorities stay clear.' },
      ]),
    ).toEqual([]))
  it.each([
    '`text`',
    'src/components/example.tsx',
    '/settings/replies',
    '#123',
    'const x = {}',
    'const answer = 42',
    "console.log('hello')",
    'C:\\work\\updates.ts',
    '<code>text</code>',
  ])('rejects code and references: %s', (body) =>
    expect(productUpdateCopyProblems([{ ...entry, body }])).toContain(
      `${entry.id}: code, path or ticket reference`,
    ),
  )
  it.each([
    { title: 'x'.repeat(61) },
    { body: 'x'.repeat(201) },
    { body: 'One. Two. Three.' },
    { publishedOn: '2026-02-30' },
    { publishedOn: 'tomorrow' },
    { icon: 'Unknown' },
    { showMe: { to: '/missing' } },
  ])('rejects invalid entry fields: %j', (fields) =>
    expect(productUpdateCopyProblems([{ ...entry, ...fields }]).length).toBeGreaterThan(
      0,
    ),
  )
  it('rejects duplicate ids and dates out of order', () => {
    expect(productUpdateCopyProblems([entry, entry])).toContain(
      `${entry.id}: duplicate id`,
    )
    expect(
      productUpdateCopyProblems([
        entry,
        { ...entry, id: '2026-10-30-older', publishedOn: '2026-10-30' },
      ]),
    ).toContain('2026-10-30-older: unsorted date')
  })
  it('resolves every icon and every actual route file', () => {
    for (const icon of PRODUCT_UPDATE_ICONS) expect(icon in icons).toBe(true)
    for (const route of PRODUCT_UPDATE_ROUTES) {
      const base = `src/routes/_authenticated${route}`
      expect(existsSync(`${base}.tsx`) || existsSync(`${base}/index.tsx`)).toBe(true)
    }
  })
})
