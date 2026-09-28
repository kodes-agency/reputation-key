import { describe, expect, it, vi } from 'vitest'
import { computeReviewContentHash } from '../../src/contexts/review/domain/rules'
import {
  OPERATOR_ACTION,
  runOperatorCommand,
  type OperatorIO,
  type OperatorRuntime,
} from '../../src/shared/ops/operator-command'
import {
  createReparseReviewTranslationsAction,
  REPARSE_REVIEW_TRANSLATIONS_COMMAND_SPEC,
  type ReviewTranslationStore,
  type WrappedReviewRow,
} from './reparse-review-translations'

const OPERATOR = 'operator@example.test'
const PROPERTY = '72000000-0000-4000-8000-000000000001'
const APPLY = [
  '--reason',
  'Re-split stored Google translations',
  '--ticket',
  'OPS-1',
  '--apply',
] as const

const WRAPPED: WrappedReviewRow = {
  id: '72000000-0000-4000-8000-000000000002',
  property_id: PROPERTY,
  rating: 5,
  text: '(Translated by Google) Great stay\n\n(Original)\nСтрахотен престой',
  reviewer_name: 'Guest',
  language_code: null,
  reviewed_at: '2026-08-01T10:00:00.000Z',
}

/** The envelope marker is present but no original follows it. */
const NO_ORIGINAL: WrappedReviewRow = {
  ...WRAPPED,
  id: '72000000-0000-4000-8000-000000000003',
  text: '(Translated by Google) Great stay\n\n(Original)\n',
}

function runtime(registered: boolean): OperatorRuntime {
  return {
    newCorrelationId: () => 'reparse-review-translations-test',
    decide: async (request) => {
      const allowed =
        registered &&
        request.principal.kind === 'operator' &&
        request.principal.id === OPERATOR
      return {
        allowed,
        reason: allowed ? 'allowed' : 'operator_not_registered',
        action: OPERATOR_ACTION,
        policyVersion: 'test',
      }
    },
  }
}

function memoryIO(): OperatorIO & { outLines: string[]; errLines: string[] } {
  const outLines: string[] = []
  const errLines: string[] = []
  return {
    outLines,
    errLines,
    out: (line) => void outLines.push(line),
    err: (line) => void errLines.push(line),
  }
}

async function run(
  argv: readonly string[],
  options: Readonly<{ registered?: boolean; rows?: readonly WrappedReviewRow[] }> = {},
) {
  const store = {
    findWrapped: vi.fn<ReviewTranslationStore['findWrapped']>(
      async () => options.rows ?? [WRAPPED],
    ),
    repair: vi.fn<ReviewTranslationStore['repair']>(async () => undefined),
  }
  const io = memoryIO()
  const result = await runOperatorCommand(
    REPARSE_REVIEW_TRANSLATIONS_COMMAND_SPEC,
    createReparseReviewTranslationsAction({ createStore: () => store }),
    runtime(options.registered ?? true),
    [...argv, '--operator', OPERATOR],
    io,
  )
  return { io, result, store }
}

describe('reparse-review-translations through the operator harness', () => {
  it('refuses an unregistered operator before any review query', async () => {
    const { result, store } = await run(['repair', ...APPLY], { registered: false })

    expect(result).toMatchObject({
      exitCode: 1,
      decision: { allowed: false, reason: 'operator_not_registered' },
    })
    expect(store.findWrapped).not.toHaveBeenCalled()
    expect(store.repair).not.toHaveBeenCalled()
  })

  it.each(['report', 'repair'])('%s reports without writing by default', async (verb) => {
    const { io, result, store } = await run([verb, '--property', PROPERTY])

    expect(result.exitCode).toBe(0)
    expect(store.findWrapped).toHaveBeenCalledWith(PROPERTY)
    expect(store.repair).not.toHaveBeenCalled()
    expect(io.outLines).toContain(
      'ops:reparse-review-translations: dry-run — 1 wrapped review(s)',
    )
  })

  it('requires an audited reason and ticket before it writes', async () => {
    const { io, result, store } = await run(['repair', '--reason', 'Re-split', '--apply'])

    expect(result.exitCode).toBe(1)
    expect(io.errLines.join('\n')).toMatch(/--ticket <ref> is required with --apply/)
    expect(store.findWrapped).not.toHaveBeenCalled()
  })

  it('never writes from report, even with --apply', async () => {
    const { io, result, store } = await run(['report', ...APPLY])

    expect(result.exitCode).toBe(1)
    expect(io.errLines.join('\n')).toMatch(/report never writes/)
    expect(store.findWrapped).not.toHaveBeenCalled()
    expect(store.repair).not.toHaveBeenCalled()
  })

  it('refuses a property filter that is not a UUID before any query', async () => {
    const { io, result, store } = await run(['report', '--property', 'not-a-uuid'])

    expect(result.exitCode).toBe(1)
    expect(io.errLines.join('\n')).toMatch(/--property must be a Property UUID/)
    expect(store.findWrapped).not.toHaveBeenCalled()
  })

  it('writes the original with recomputed derived columns, skipping empty originals', async () => {
    const { io, result, store } = await run(['repair', ...APPLY], {
      rows: [WRAPPED, NO_ORIGINAL],
    })

    expect(result.exitCode).toBe(0)
    expect(store.findWrapped).toHaveBeenCalledWith(null)
    expect(store.repair).toHaveBeenCalledTimes(1)
    expect(store.repair).toHaveBeenCalledWith(
      WRAPPED.id,
      expect.objectContaining({
        text: 'Страхотен престой',
        translatedText: 'Great stay',
        contentHash: computeReviewContentHash({
          rating: 5,
          text: 'Страхотен престой',
          reviewerName: 'Guest',
          languageCode: null,
        }),
      }),
    )
    expect(io.outLines).toContain(`  SKIP ${NO_ORIGINAL.id}: envelope yields no original`)
    expect(io.outLines).toContain(
      'ops:reparse-review-translations: applied — 1 wrapped review(s), 1 skipped',
    )
  })
})
