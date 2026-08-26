import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function directlyAccessedRepositories(source: string): string[] {
  return [...source.matchAll(/\bcontainer\.([A-Za-z][A-Za-z0-9]*Repo)\b/gu)].map(
    ([, repository]) => repository!,
  )
}

describe('composition container boundary evidence', () => {
  it('detects a deliberately exposed infrastructure repository', () => {
    expect(
      directlyAccessedRepositories(
        'export const load = () => container.reviewRepo.findById("review-1")',
      ),
    ).toEqual(['reviewRepo'])
  })

  it('keeps the current Review repository exposure explicit until its public port migration', () => {
    const aiServer = readFileSync(
      resolve('src/contexts/ai/server/reply-suggestion.ts'),
      'utf8',
    )
    const composition = readFileSync(resolve('src/composition.ts'), 'utf8')

    expect(directlyAccessedRepositories(aiServer)).toEqual(['reviewRepo', 'reviewRepo'])
    expect(composition).toContain('reviewRepo: review.internal.repos.reviewRepo')
  })
})
