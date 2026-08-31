import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeContentAddressed, writeOnce } from './write-once'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'repkey-write-once-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('writeOnce', () => {
  it('creates the file and reports it', () => {
    const path = join(dir, 'evidence.json')

    expect(writeOnce(path, '{"a":1}')).toEqual({ status: 'written' })
    expect(readFileSync(path, 'utf8')).toBe('{"a":1}')
  })

  it('never replaces existing bytes', () => {
    const path = join(dir, 'evidence.json')
    writeFileSync(path, 'original', 'utf8')

    expect(writeOnce(path, 'replacement')).toEqual({ status: 'already_present' })
    // The whole point: an artifact that can be rewritten is not evidence.
    expect(readFileSync(path, 'utf8')).toBe('original')
  })

  it('reports a real write failure distinctly from an existing file', () => {
    const outcome = writeOnce(join(dir, 'missing-directory', 'evidence.json'), 'x')

    expect(outcome.status).toBe('failed')
    if (outcome.status === 'failed') expect(outcome.message).toMatch(/ENOENT/u)
  })
})

describe('writeContentAddressed', () => {
  it('treats an existing sibling as success, because the name is the content', () => {
    const path = join(dir, 'abc.dependency')
    writeFileSync(path, 'same bytes', 'utf8')

    expect(writeContentAddressed(path, 'same bytes')).toEqual({ status: 'written' })
  })

  it('still reports a real failure', () => {
    expect(writeContentAddressed(join(dir, 'nope', 'a.dependency'), 'x').status).toBe(
      'failed',
    )
  })
})
