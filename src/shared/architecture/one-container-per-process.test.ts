// ARC-03-T15 — entry points claim one complete Application Container per process.
// The claim itself and the worker-only registration edge are fast, in-process facts.

import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  claimProcessContainer,
  DUPLICATE_CONTAINER_ERROR,
  releaseProcessContainer,
} from '#/composition'
import { walk } from '#/shared/testing/source-tree'

const ROOT = process.cwd()
const TESTING_ROOT = `${join(ROOT, 'src/shared/testing')}${sep}`

afterEach(releaseProcessContainer)

describe('one complete Application Container per process', () => {
  it('refuses a second container by name', () => {
    claimProcessContainer('web')

    expect(() => claimProcessContainer('web')).toThrow(DUPLICATE_CONTAINER_ERROR)
    // A DIFFERENT process kind is refused too — one process, one container.
    expect(() => claimProcessContainer('worker')).toThrow(DUPLICATE_CONTAINER_ERROR)
  })

  it('permits exactly one rebuild after release', () => {
    claimProcessContainer('web')
    releaseProcessContainer()

    claimProcessContainer('worker')
    expect(() => claimProcessContainer('worker')).toThrow(DUPLICATE_CONTAINER_ERROR)
  })

  it('keeps job and consumer registration on the worker process', () => {
    const bootstrapImporters = walk(join(ROOT, 'src'))
      .filter(
        (file) =>
          file.endsWith('.ts') &&
          !file.endsWith('.test.ts') &&
          !file.startsWith(TESTING_ROOT),
      )
      .filter((file) => /from ['"]#\/bootstrap['"]/u.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file).split(sep).join('/'))
      .sort()

    expect(bootstrapImporters).toEqual(['src/worker/index.ts'])
  })
})
