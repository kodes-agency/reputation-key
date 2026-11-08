import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'src')
const WRITER_DIRECTORY = 'src/contexts/reputation/replies/'

/** The reply table and the publication evidence tables that hang off it. */
const REPLY_TABLES = [
  'replies',
  'reply_publication_attempts',
  'reply_publication_authorizations',
]
const REPLY_TABLE_SYMBOLS = [
  'replies',
  'replyPublicationAttempts',
  'replyPublicationAuthorizations',
]

const REPLY_WRITES = [
  new RegExp(`\\.(update|insert|delete)\\(\\s*(${REPLY_TABLE_SYMBOLS.join('|')})\\s*\\)`),
  new RegExp(
    `\\b(UPDATE|DELETE\\s+FROM|INSERT\\s+INTO)\\s+"?(${REPLY_TABLES.join('|')})"?\\b`,
    'i',
  ),
]

const writesReplies = (source: string): boolean =>
  REPLY_WRITES.some((pattern) => pattern.test(source))

function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory())
      return entry.name === 'testing' ? [] : productionSources(path)
    return /\.tsx?$/.test(entry.name) && !/\.(test|stories)\.tsx?$/.test(entry.name)
      ? [path]
      : []
  })
}

describe('one writer of Reply and publication evidence rows', () => {
  it('recognises a builder write and a raw SQL write', () => {
    expect(writesReplies('await tx.update(replies).set({})')).toBe(true)
    expect(writesReplies('await tx.delete(replies)\n.where(x)')).toBe(true)
    expect(writesReplies("sql`UPDATE replies SET text = ''`")).toBe(true)
    expect(writesReplies('sql`DELETE FROM replies AS reply`')).toBe(true)
    expect(writesReplies('tx.select().from(replies)')).toBe(false)
    expect(writesReplies('UPDATE reply_publication_attempts SET outcome = 1')).toBe(true)
    expect(writesReplies('DELETE FROM reply_publication_attempts WHERE x')).toBe(true)
    expect(writesReplies('await tx.insert(replyPublicationAttempts).values({})')).toBe(
      true,
    )
    expect(writesReplies('tx.update(replyPublicationAuthorizations).set({})')).toBe(true)
    expect(writesReplies('tx.select().from(replyPublicationAttempts)')).toBe(false)
    expect(writesReplies('SELECT 1 FROM reply_publication_attempts')).toBe(false)
  })

  it('has no Reply write outside the Reputation writer', () => {
    const offenders = productionSources(SRC)
      .map((path) => relative(process.cwd(), path))
      .filter((path) => !path.startsWith(WRITER_DIRECTORY))
      .filter((path) => writesReplies(readFileSync(path, 'utf8')))
    expect(offenders).toEqual([])
  })
})
