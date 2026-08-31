import { describe, expect, it } from 'vitest'
import type { OrganizationExportEntry } from '../application/organization-export-contract'
import { DeterministicZipArchiveWriter } from './deterministic-zip-archive-writer'

function entry(path: string, value: string): OrganizationExportEntry {
  return {
    path,
    mediaType: path.endsWith('.json') ? 'application/json' : 'text/markdown',
    classification: 'tenant_visible',
    bytes: Buffer.from(value, 'utf8'),
  }
}

function localEntries(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes)
  const result: Array<{ path: string; bytes: Buffer }> = []
  let offset = 0
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 22)
    const pathLength = buffer.readUInt16LE(offset + 26)
    const extraLength = buffer.readUInt16LE(offset + 28)
    const pathStart = offset + 30
    const dataStart = pathStart + pathLength + extraLength
    result.push({
      path: buffer.subarray(pathStart, pathStart + pathLength).toString('utf8'),
      bytes: buffer.subarray(dataStart, dataStart + size),
    })
    offset = dataStart + size
  }
  return result
}

describe('deterministic Organization Export ZIP writer', () => {
  it('writes byte-stable UTF-8 ZIP entries without changing their contents', async () => {
    const writer = DeterministicZipArchiveWriter.create()
    const entries = [entry('schema.json', '{"v":1}\n'), entry('README.md', '# Export\n')]

    const first = await writer.writeZip(entries)
    const second = await writer.writeZip([...entries].reverse())

    expect(first).toEqual(second)
    expect(Buffer.from(first).readUInt32LE(0)).toBe(0x04034b50)
    expect(localEntries(first)).toEqual([
      { path: 'README.md', bytes: Buffer.from('# Export\n') },
      { path: 'schema.json', bytes: Buffer.from('{"v":1}\n') },
    ])
    expect(Buffer.from(first).includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBe(true)
  })

  it('uses locale-independent UTF-8 byte order for canonical archive paths', async () => {
    const writer = DeterministicZipArchiveWriter.create()

    expect(
      localEntries(await writer.writeZip([entry('a.json', 'a'), entry('B.md', 'b')])).map(
        (candidate) => candidate.path,
      ),
    ).toEqual(['B.md', 'a.json'])
  })

  it('refuses duplicate paths and archives beyond the configured bound', async () => {
    const writer = DeterministicZipArchiveWriter.create(256)
    await expect(
      writer.writeZip([entry('README.md', 'a'), entry('README.md', 'b')]),
    ).rejects.toThrow(/duplicate path/)
    await expect(writer.writeZip([entry('README.md', 'x'.repeat(256))])).rejects.toThrow(
      /bounded size/,
    )
  })
})
