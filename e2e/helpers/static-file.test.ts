import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { resolveStaticFile } from './static-file'

let root: string
let outside: string

beforeAll(() => {
  const base = mkdtempSync(join(tmpdir(), 'static-file-'))
  root = join(base, 'site')
  outside = join(base, 'secret.txt')
  mkdirSync(join(root, 'assets'), { recursive: true })
  writeFileSync(join(root, 'index.html'), '<p>home</p>')
  writeFileSync(join(root, 'iframe.html'), '<p>story</p>')
  writeFileSync(join(root, 'assets', 'app.js'), 'x')
  writeFileSync(join(root, 'my file.txt'), 'x')
  writeFileSync(outside, 'secret')
})

afterAll(() => {
  rmSync(join(root, '..'), { recursive: true, force: true })
})

describe('resolveStaticFile', () => {
  test('serves a file inside the root', () => {
    expect(resolveStaticFile(root, '/assets/app.js')).toBe(join(root, 'assets', 'app.js'))
  })

  test('serves a directory’s index.html', () => {
    expect(resolveStaticFile(root, '/')).toBe(join(root, 'index.html'))
  })

  test('drops the query string', () => {
    expect(resolveStaticFile(root, '/iframe.html?id=a&viewMode=story')).toBe(
      join(root, 'iframe.html'),
    )
    expect(resolveStaticFile(root, '/assets/app.js?v=2')).toBe(
      join(root, 'assets', 'app.js'),
    )
  })

  test('decodes percent-escapes in the path', () => {
    expect(resolveStaticFile(root, '/my%20file.txt')).toBe(join(root, 'my file.txt'))
  })

  test('refuses a path that climbs out of the root', () => {
    expect(resolveStaticFile(root, '/../secret.txt')).toBeNull()
    expect(resolveStaticFile(root, '/%2e%2e/secret.txt')).toBeNull()
    expect(resolveStaticFile(root, '/assets/../../secret.txt')).toBeNull()
  })

  test('refuses a sibling directory that merely shares the root’s name as a prefix', () => {
    const sibling = `${root}-other`
    mkdirSync(sibling, { recursive: true })
    writeFileSync(join(sibling, 'x.txt'), 'x')
    expect(resolveStaticFile(root, '/../site-other/x.txt')).toBeNull()
  })

  test('answers null for a missing file and for a malformed escape', () => {
    expect(resolveStaticFile(root, '/nope.js')).toBeNull()
    expect(resolveStaticFile(root, '/%E0%A4%A')).toBeNull()
  })
})
