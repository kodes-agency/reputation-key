import { Linter } from 'eslint'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import tseslint from 'typescript-eslint'
import { describe, expect, it } from 'vitest'
const { default: schemaWriters } = await import(
  pathToFileURL(resolve('eslint-rules/schema-writers.mjs')).href
)
const { default: sourcePolicy } = await import(
  pathToFileURL(resolve('eslint-rules/source-policy.mjs')).href
)

function messages(code: string, filename: string, plugin: unknown, rule: string) {
  return new Linter()
    .verify(
      code,
      [
        {
          files: ['**/*.{ts,tsx}'],
          languageOptions: { parser: tseslint.parser },
          plugins: { policy: plugin as never },
          rules: { [`policy/${rule}`]: 'error' },
        },
      ],
      { filename },
    )
    .map(({ messageId }) => messageId)
}

const owner = (code: string, filename: string) =>
  messages(code, filename, schemaWriters, 'owner')
const outsider = 'src/contexts/review/infrastructure/some-store.ts'
const replyOwner = 'src/contexts/reputation/replies/store.server.ts'

describe('schema writer ownership lint rule', () => {
  it.each([
    'await tx.update(replies).set({ body })',
    'await db.insert(replyPublicationAttempts).values(row)',
    'await db.delete(schema.replyPublicationAuthorizations).where(x)',
    "await db.execute(sql`UPDATE replies SET body = ''`)",
    'await db.execute(sql`DELETE FROM reply_publication_attempts WHERE x`)',
    'await db.execute(sql`INSERT INTO "replies" (id) VALUES (1)`)',
  ])('rejects a write outside the owner: %s', (code) => {
    expect(owner(code, outsider)).toEqual(['notOwner'])
  })

  it('rejects a second writer of a Feed table', () => {
    expect(
      owner('await db.insert(auditEvents).values(row)', 'src/contexts/review/x.ts'),
    ).toEqual(['notOwner'])
    expect(
      owner('await db.update(notifications).set(x)', 'src/contexts/inbox/x.ts'),
    ).toEqual(['notOwner'])
  })

  it('allows the owner and reads from anywhere', () => {
    expect(owner('await tx.update(replies).set({ body })', replyOwner)).toEqual([])
    expect(
      owner(
        'await db.insert(auditEvents).values(row)',
        'src/contexts/feed/audit/write.ts',
      ),
    ).toEqual([])
    expect(
      owner('await db.update(notifications).set(x)', 'src/contexts/feed/notify/w.ts'),
    ).toEqual([])
    expect(owner('await db.select().from(replies)', outsider)).toEqual([])
    expect(owner('await db.execute(sql`SELECT 1 FROM replies`)', outsider)).toEqual([])
    expect(owner('await db.update(properties).set(x)', outsider)).toEqual([])
  })
})

describe('browser entries stay out of server modules', () => {
  it.each(['src/client.tsx', 'src/instrument.client.ts'])(
    'rejects a *.server import in %s',
    (filename) => {
      expect(
        messages(
          "import { sign } from '#/shared/db/pool.server'",
          filename,
          sourcePolicy,
          'browser-server',
        ),
      ).toEqual(['serverOnly'])
      expect(
        messages(
          "import { rememberRecordedError } from '#/shared/observability/recorded-browser-errors'",
          filename,
          sourcePolicy,
          'browser-server',
        ),
      ).toEqual([])
    },
  )
})
