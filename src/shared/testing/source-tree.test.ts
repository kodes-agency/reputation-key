import { describe, expect, it } from 'vitest'
import { stripComments } from './source-tree'

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
