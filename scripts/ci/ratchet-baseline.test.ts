import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  compareWithBaseline,
  parseBaseline,
  runRatchetGate,
  serializeBaseline,
  type RatchetGate,
} from './ratchet-baseline'

describe('ratchet baseline comparison', () => {
  it('passes silently while every count equals its entry', () => {
    expect(compareWithBaseline({ 'a.ts': 3 }, { 'a.ts': 3 })).toEqual({
      regressions: [],
      improvements: [],
    })
  })

  it('fails a count that rose, and a file the baseline does not name', () => {
    expect(compareWithBaseline({ 'a.ts': 3 }, { 'a.ts': 4, 'new.ts': 1 })).toEqual({
      regressions: [
        { file: 'a.ts', baseline: 3, current: 4 },
        { file: 'new.ts', baseline: 0, current: 1 },
      ],
      improvements: [],
    })
  })

  it('reports a fallen count, including a file that dropped out entirely', () => {
    expect(compareWithBaseline({ 'a.ts': 3, 'gone.ts': 2 }, { 'a.ts': 1 })).toEqual({
      regressions: [],
      improvements: [
        { file: 'a.ts', baseline: 3, current: 1 },
        { file: 'gone.ts', baseline: 2, current: 0 },
      ],
    })
  })
})

describe('ratchet baseline bytes', () => {
  it('sorts entries and drops zeroes, so a rewrite diffs cleanly', () => {
    const bytes = serializeBaseline({ 'b.ts': 2, 'clean.ts': 0, 'a.ts': 1 })

    expect(bytes).toBe('{\n  "a.ts": 1,\n  "b.ts": 2\n}\n')
    expect(parseBaseline(bytes)).toEqual({ 'a.ts': 1, 'b.ts': 2 })
  })

  it('rejects anything but path → positive integer', () => {
    expect(() => parseBaseline('[]')).toThrow(TypeError)
    expect(() => parseBaseline('{"a.ts": 0}')).toThrow(/a\.ts must be a positive integer/)
    expect(() => parseBaseline('{"a.ts": 1.5}')).toThrow(
      /a\.ts must be a positive integer/,
    )
    expect(() => parseBaseline('{"a.ts": "3"}')).toThrow(
      /a\.ts must be a positive integer/,
    )
    expect(() => parseBaseline('{')).toThrow(SyntaxError)
  })
})

describe('ratchet gate run', () => {
  let directory: string
  let gate: RatchetGate
  let stdout: string[]
  let stderr: string[]

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'repkey-ratchet-'))
    gate = {
      name: 'fixture',
      baselinePath: join(directory, 'baseline.json'),
      writeCommand: 'pnpm fixture --write-baseline',
      explainRegressions: () => 'fix it',
      summary: 'fine',
    }
    stdout = []
    stderr = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk))
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(String(chunk))
      return true
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(directory, { recursive: true, force: true })
  })

  it('exits 1 and explains when a count rises', () => {
    writeFileSync(gate.baselinePath, serializeBaseline({ 'a.ts': 1 }))

    expect(runRatchetGate(gate, { 'a.ts': 2 }, [])).toBe(1)
    expect(stderr.join('')).toContain('1 file(s) above the baseline:\nfix it')
  })

  it('exits 0 when counts fall, and asks for the baseline to be lowered', () => {
    writeFileSync(gate.baselinePath, serializeBaseline({ 'a.ts': 2 }))

    expect(runRatchetGate(gate, { 'a.ts': 1 }, [])).toBe(0)
    expect(stdout.join('')).toContain('run `pnpm fixture --write-baseline`')
    expect(stdout.join('')).toContain('  a.ts: 2 → 1')
  })

  it('exits 1 with the create command when the baseline is missing', () => {
    expect(runRatchetGate(gate, {}, [])).toBe(1)
    expect(stderr.join('')).toContain('Create it with: pnpm fixture --write-baseline')
  })

  it('rewrites the baseline from the current counts on --write-baseline', () => {
    expect(runRatchetGate(gate, { 'b.ts': 5, 'a.ts': 7 }, ['--write-baseline'])).toBe(0)
    expect(readFileSync(gate.baselinePath, 'utf8')).toBe(
      serializeBaseline({ 'a.ts': 7, 'b.ts': 5 }),
    )
  })
})
