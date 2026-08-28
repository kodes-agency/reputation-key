import { crc32 } from 'node:zlib'
import type { OrganizationExportArchiveWriter } from '../application/ports/organization-export.port'
import {
  compareOrganizationExportPath,
  type OrganizationExportEntry,
} from '../application/organization-export-contract'

const LOCAL_FILE_HEADER = 0x04034b50
const CENTRAL_DIRECTORY_HEADER = 0x02014b50
const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const UTF8_FLAG = 0x0800
const ZIP_VERSION_20 = 20
const UNIX_ZIP_VERSION_20 = 0x0314
const DOS_1980_01_01 = 0x0021
const DEFAULT_MAX_ARCHIVE_BYTES = 128 * 1024 * 1024
const MAX_ENTRY_COUNT = 10_000
const UINT32_MAX = 0xffffffff

type EncodedEntry = Readonly<{
  path: Buffer
  bytes: Buffer
  checksum: number
  offset: number
}>

function encodeEntry(entry: OrganizationExportEntry, offset: number): EncodedEntry {
  const path = Buffer.from(entry.path, 'utf8')
  const bytes = Buffer.from(entry.bytes)
  if (path.byteLength === 0 || path.byteLength > 0xffff) {
    throw new Error('Organization Export ZIP path length is invalid')
  }
  if (bytes.byteLength > UINT32_MAX) {
    throw new Error('Organization Export ZIP entry requires unsupported ZIP64')
  }
  return { path, bytes, checksum: crc32(bytes), offset }
}

function localHeader(entry: EncodedEntry): Buffer {
  const header = Buffer.alloc(30)
  header.writeUInt32LE(LOCAL_FILE_HEADER, 0)
  header.writeUInt16LE(ZIP_VERSION_20, 4)
  header.writeUInt16LE(UTF8_FLAG, 6)
  header.writeUInt16LE(0, 8) // stored; archive bytes remain lossless
  header.writeUInt16LE(0, 10)
  header.writeUInt16LE(DOS_1980_01_01, 12)
  header.writeUInt32LE(entry.checksum, 14)
  header.writeUInt32LE(entry.bytes.byteLength, 18)
  header.writeUInt32LE(entry.bytes.byteLength, 22)
  header.writeUInt16LE(entry.path.byteLength, 26)
  header.writeUInt16LE(0, 28)
  return header
}

function centralHeader(entry: EncodedEntry): Buffer {
  const header = Buffer.alloc(46)
  header.writeUInt32LE(CENTRAL_DIRECTORY_HEADER, 0)
  header.writeUInt16LE(UNIX_ZIP_VERSION_20, 4)
  header.writeUInt16LE(ZIP_VERSION_20, 6)
  header.writeUInt16LE(UTF8_FLAG, 8)
  header.writeUInt16LE(0, 10)
  header.writeUInt16LE(0, 12)
  header.writeUInt16LE(DOS_1980_01_01, 14)
  header.writeUInt32LE(entry.checksum, 16)
  header.writeUInt32LE(entry.bytes.byteLength, 20)
  header.writeUInt32LE(entry.bytes.byteLength, 24)
  header.writeUInt16LE(entry.path.byteLength, 28)
  header.writeUInt16LE(0, 30)
  header.writeUInt16LE(0, 32)
  header.writeUInt16LE(0, 34)
  header.writeUInt16LE(0, 36)
  header.writeUInt32LE(0, 38)
  header.writeUInt32LE(entry.offset, 42)
  return header
}

export class DeterministicZipArchiveWriter implements OrganizationExportArchiveWriter {
  static create(
    maxArchiveBytes = DEFAULT_MAX_ARCHIVE_BYTES,
  ): DeterministicZipArchiveWriter {
    if (
      !Number.isSafeInteger(maxArchiveBytes) ||
      maxArchiveBytes < 1 ||
      maxArchiveBytes > UINT32_MAX
    ) {
      throw new Error('Organization Export ZIP byte limit is invalid')
    }
    return new DeterministicZipArchiveWriter(maxArchiveBytes)
  }

  private constructor(private readonly maxArchiveBytes: number) {}

  async writeZip(entries: readonly OrganizationExportEntry[]): Promise<Uint8Array> {
    if (entries.length === 0 || entries.length > MAX_ENTRY_COUNT) {
      throw new Error('Organization Export ZIP entry count is invalid')
    }
    const sorted = [...entries].sort((left, right) =>
      compareOrganizationExportPath(left.path, right.path),
    )
    if (new Set(sorted.map((entry) => entry.path)).size !== sorted.length) {
      throw new Error('Organization Export ZIP contains a duplicate path')
    }

    const localParts: Buffer[] = []
    const encoded: EncodedEntry[] = []
    let offset = 0
    for (const source of sorted) {
      const entry = encodeEntry(source, offset)
      const header = localHeader(entry)
      const entryLength =
        header.byteLength + entry.path.byteLength + entry.bytes.byteLength
      if (
        offset + entryLength > this.maxArchiveBytes ||
        offset + entryLength > UINT32_MAX
      ) {
        throw new Error('Organization Export ZIP exceeds its bounded size')
      }
      localParts.push(header, entry.path, entry.bytes)
      encoded.push(entry)
      offset += entryLength
    }

    const centralParts: Buffer[] = []
    let centralSize = 0
    for (const entry of encoded) {
      const header = centralHeader(entry)
      centralParts.push(header, entry.path)
      centralSize += header.byteLength + entry.path.byteLength
    }
    const totalSize = offset + centralSize + 22
    if (totalSize > this.maxArchiveBytes || totalSize > UINT32_MAX) {
      throw new Error('Organization Export ZIP exceeds its bounded size')
    }

    const end = Buffer.alloc(22)
    end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0)
    end.writeUInt16LE(0, 4)
    end.writeUInt16LE(0, 6)
    end.writeUInt16LE(encoded.length, 8)
    end.writeUInt16LE(encoded.length, 10)
    end.writeUInt32LE(centralSize, 12)
    end.writeUInt32LE(offset, 16)
    end.writeUInt16LE(0, 20)
    return Buffer.concat([...localParts, ...centralParts, end], totalSize)
  }
}
