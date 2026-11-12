import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const INBOX_DIRS = [
  import.meta.dirname,
  join(import.meta.dirname, '..', '..', 'contexts', 'reputation', 'inbox', 'ui'),
]

function sources(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.tsx') && !name.endsWith('.stories.tsx'))
    .map((name) => readFileSync(join(directory, name), 'utf8'))
}

describe('the Inbox on a phone', () => {
  it('keeps the 44px tap target: no screen or dialog drops to the compact density', () => {
    const compact = INBOX_DIRS.flatMap(sources).filter((source) =>
      /density=["']compact["']/u.test(source),
    )
    expect(compact).toEqual([])
  })
})

describe('the toaster on a phone', () => {
  it('spans the window instead of hanging past its right edge', () => {
    const styles = readFileSync(
      join(import.meta.dirname, '..', '..', 'styles.css'),
      'utf8',
    )
    expect(styles).toMatch(
      /\[data-sonner-toaster\]\[data-x-position\]\s*\{\s*left:\s*0;\s*right:\s*0;/u,
    )
  })
})
