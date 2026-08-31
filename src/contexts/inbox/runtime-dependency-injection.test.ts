import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const read = (file: string): string => readFileSync(join(ROOT, file), 'utf8')

describe('Inbox ARC-03 runtime dependency injection', () => {
  it('keeps context logging composition-owned', () => {
    for (const file of [
      'src/contexts/inbox/infrastructure/event-handlers/on-feedback-retracted.ts',
      'src/contexts/inbox/infrastructure/event-handlers/on-feedback-submitted.ts',
      'src/contexts/inbox/infrastructure/event-handlers/on-reply-submitted.ts',
      'src/contexts/inbox/infrastructure/event-handlers/on-review-created.ts',
      'src/contexts/inbox/infrastructure/event-handlers/on-review-expired.ts',
      'src/contexts/inbox/infrastructure/outbox-consumers.ts',
      'src/contexts/inbox/infrastructure/repositories/inbox.repository.ts',
      'src/contexts/inbox/server/inbox-queries.ts',
    ]) {
      expect(read(file), file).not.toMatch(/\bgetLogger\s*\(/u)
    }
  })

  it('keeps persistence clocks composition-owned', () => {
    for (const file of [
      'src/contexts/inbox/infrastructure/inbox-command-store.ts',
      'src/contexts/inbox/infrastructure/repositories/inbox-view.repository.ts',
      'src/contexts/inbox/infrastructure/repositories/inbox.repository.ts',
    ]) {
      const source = read(file)
      expect(source, file).not.toMatch(/\bnew Date\s*\(\s*\)/u)
      expect(source, file).not.toMatch(/\bDate\.now\s*\(/u)
    }
  })

  it('wires the injected logger and clock through the Inbox build', () => {
    const source = read('src/contexts/inbox/build.ts')
    expect(source).toMatch(/createInboxRepository\(\s*input\.db/u)
    expect(source).toContain('logger: input.logger')
    expect(source).toContain('clock: input.clock')
    expect(source).toMatch(
      /createAtomicInboxCommandStore\(\s*input\.db,\s*input\.events,\s*input\.authorizeCommand,\s*input\.clock/u,
    )
  })

  it('keeps durable cutover configuration composition-owned', () => {
    const handlers = read('src/contexts/inbox/infrastructure/event-handlers/index.ts')
    expect(handlers).not.toContain('resolveCutoverState')
    expect(handlers).not.toMatch(/cutoverState\?:/u)

    const build = read('src/contexts/inbox/build.ts')
    expect(build).toContain('cutoverState: (family: CutoverFamily) => CutoverState')
    expect(build).toContain('cutoverState: input.cutoverState')
  })
})
