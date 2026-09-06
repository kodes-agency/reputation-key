import { describe, expect, it } from 'vitest'
import {
  buildSnapshot,
  compareSnapshots,
  digestOf,
  type ContractSnapshot,
} from './check-runtime-environment-contract'

const read = (contents: Record<string, string>) => (path: string) => {
  const value = contents[path]
  if (value === undefined) throw new Error(`missing fixture ${path}`)
  return value
}

describe('runtime environment contract tripwire', () => {
  it('is stable while the contract files are byte-identical', () => {
    const files = ['b.ts', 'a.ts']
    const contents = { 'a.ts': 'alpha', 'b.ts': 'beta' }

    const first = buildSnapshot(read(contents), files)
    const second = buildSnapshot(read(contents), files)

    expect(compareSnapshots(first, second)).toEqual([])
    // Order of the input list must not change the snapshot — otherwise the
    // gate would fail on a reordered constant and train people to ignore it.
    expect(Object.keys(first.files)).toEqual(['a.ts', 'b.ts'])
  })

  it('reports the exact file whose contract moved', () => {
    const files = ['a.ts', 'b.ts']
    const before = buildSnapshot(read({ 'a.ts': 'alpha', 'b.ts': 'beta' }), files)
    const after = buildSnapshot(read({ 'a.ts': 'alpha', 'b.ts': 'BETA' }), files)

    expect(compareSnapshots(before, after)).toEqual([{ path: 'b.ts', reason: 'changed' }])
  })

  it('distinguishes an added contract file from a changed one', () => {
    const recorded: ContractSnapshot = {
      version: 1,
      files: { 'a.ts': digestOf('alpha') },
    }
    const current = buildSnapshot(read({ 'a.ts': 'alpha', 'new.ts': 'fresh' }), [
      'a.ts',
      'new.ts',
    ])

    expect(compareSnapshots(recorded, current)).toEqual([
      { path: 'new.ts', reason: 'added' },
    ])
  })

  it('reports a removed contract file rather than silently passing', () => {
    const recorded: ContractSnapshot = {
      version: 1,
      files: { 'a.ts': digestOf('alpha'), 'gone.ts': digestOf('bye') },
    }
    const current = buildSnapshot(read({ 'a.ts': 'alpha' }), ['a.ts'])

    expect(compareSnapshots(recorded, current)).toEqual([
      { path: 'gone.ts', reason: 'removed' },
    ])
  })
})
