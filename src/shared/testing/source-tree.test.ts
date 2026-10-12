import { describe, expect, it } from 'vitest'
import { readUiSources, stripComments } from './source-tree'

describe('stripComments', () => {
  it('drops a block comment, including one that spans lines', () => {
    expect(stripComments('a /* one\ntwo */ b')).toBe('a  b')
  })

  it('drops a line comment, from the line start or after code', () => {
    expect(stripComments('// whole line\nconst a = 1 // tail')).toBe('\nconst a = 1 ')
  })

  it('keeps the double slash of a URL, which follows a colon, not whitespace', () => {
    expect(stripComments("const url = 'https://example.com/a'")).toBe(
      "const url = 'https://example.com/a'",
    )
  })

  it('leaves code that quotes no comment as it was', () => {
    expect(stripComments('<Link to="/x" aria-current="page" />')).toBe(
      '<Link to="/x" aria-current="page" />',
    )
  })
})

describe('readUiSources', () => {
  it('reads components and routes, with root-relative paths', () => {
    const paths = readUiSources().map((file) => file.path)

    expect(paths).toContain('src/components/ui/button.tsx')
    expect(paths.some((path) => path.startsWith('src/routes/'))).toBe(true)
  })

  it('reads no story and no test', () => {
    const paths = readUiSources({ includeTs: true }).map((file) => file.path)

    expect(paths.filter((path) => /\.(stories|test)\./u.test(path))).toEqual([])
  })

  it('reads .tsx only, unless asked for .ts too', () => {
    const tsx = readUiSources().map((file) => file.path)
    const both = readUiSources({ includeTs: true }).map((file) => file.path)

    expect(tsx.filter((path) => path.endsWith('.ts'))).toEqual([])
    expect(both.some((path) => path.endsWith('.ts'))).toBe(true)
  })

  it('drops comments unless asked to keep them', () => {
    const find = (comments?: 'kept') =>
      readUiSources({ comments }).find(
        (file) => file.path === 'src/components/forms/setting-switch-row.tsx',
      )

    expect(find()?.text).not.toContain('UI consistency scan')
    expect(find('kept')?.text).toContain('UI consistency scan')
  })
})
