import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ADR_DIRECTORY = join(process.cwd(), 'docs', 'adr')
const ADR_INDEX = join(ADR_DIRECTORY, 'README.md')
const ADR_FILE = /^\d{4}-[a-z0-9-]+\.md$/
const ADR_LINK = /\]\((\d{4}-[a-z0-9-]+\.md)\)/g

describe('ADR navigation authority', () => {
  it('indexes every issued ADR exactly once and no missing file', () => {
    const issued = readdirSync(ADR_DIRECTORY)
      .filter((file) => ADR_FILE.test(file))
      .sort()
    const index = readFileSync(ADR_INDEX, 'utf8')
    const linked = [...index.matchAll(ADR_LINK)].map((match) => match[1]!).sort()

    expect(new Set(linked).size).toBe(linked.length)
    expect(linked).toEqual(issued)
  })

  it.each([
    '0054-data-cell-catalogue-and-routing.md',
    '0055-stable-review-and-inbox-handling-cycles.md',
    '0056-operational-action-history-integrity-claims.md',
    '0057-single-us-beta-data-cell.md',
    '0058-dedicated-railway-projects-and-iac-source-promotion.md',
  ])('%s is an accepted superseding decision', (file) => {
    const content = readFileSync(join(ADR_DIRECTORY, file), 'utf8')

    expect(content).toMatch(/^---\nstatus: accepted\ndate: \d{4}-\d{2}-\d{2}\n---/)
    expect(content).toContain('## Supersession')
    expect(basename(file)).toMatch(ADR_FILE)
  })
})
