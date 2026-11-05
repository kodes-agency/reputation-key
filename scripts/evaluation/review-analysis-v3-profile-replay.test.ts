import { describe, expect, it, vi } from 'vitest'
import { runEvaluationCli, type CliIo } from './review-analysis-v3'
import { prepareEvaluationItem } from './review-analysis-v3-provider'
import { answer, item, mention } from './review-analysis-v3.test-fixtures'

// Keep the real redactor, but make the caller expect a different profile digest.
vi.mock('#/shared/ai-deterministic-redactor', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('#/shared/ai-deterministic-redactor')>()
  return { ...original, AI_REDACTION_PROFILE_DIGEST: 'stale-profile-digest' }
})

describe('offline replay with a mismatched redaction profile', () => {
  it.each(['fake-gold', 'answers:recorded.jsonl'])(
    'blocks %s before an answer can be accepted',
    async (provider) => {
      const review = item()
      const label = answer([mention()])
      const inputs = new Map([
        ['items.jsonl', JSON.stringify(review)],
        [
          'gold.jsonl',
          JSON.stringify({
            id: review.id,
            ...label,
            gold_source: 'round1_both_families',
          }),
        ],
        ['recorded.jsonl', JSON.stringify({ id: review.id, answer: label })],
      ])
      const outputs = new Map<string, string>()
      const io: CliIo = {
        readFile: (path) => {
          const source = inputs.get(path)
          if (source === undefined) throw new Error(`unexpected input: ${path}`)
          return source
        },
        writeFile: (path, content) => outputs.set(path, content),
        makeDirectory: () => {},
        print: () => {},
        printError: (message) => {
          throw new Error(message)
        },
        now: () => new Date(0),
      }

      expect(prepareEvaluationItem(review)).toEqual({
        status: 'redaction_blocked',
        itemId: review.id,
        reason: 'profile_mismatch',
      })
      const code = await runEvaluationCli(
        [
          '--providers',
          provider,
          '--items',
          'items.jsonl',
          '--gold',
          'gold.jsonl',
          '--out',
          'out',
        ],
        io,
      )

      expect(code).toBe(1)
      const report = JSON.parse(outputs.get('out/report.json') ?? '')
      expect(report.testSet.notSentIds).toEqual([review.id])
      expect(report.providers[0].runs[0].scores.gating.all.robustness).toMatchObject({
        byStatus: { redaction_blocked: 1 },
        usableRate: 0,
      })
      const labels = [...outputs].find(([path]) => path.endsWith('.jsonl'))?.[1]
      expect(JSON.parse(labels ?? '')).toMatchObject({
        id: review.id,
        status: 'redaction_blocked',
        answer: null,
      })
    },
  )
})
