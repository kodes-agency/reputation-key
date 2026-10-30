// The providers the evaluation command can name. None of them reaches a network.
//
//   fake-gold        answers every item with its own gold label: the harness's
//                    smoke test and the ceiling of its scores.
//   answers:<file>   scores answers recorded elsewhere (one JSON object per line,
//                    `{ "id": ..., "answer": ... }`), so a real provider can be run
//                    by any governed tool and measured here without this command
//                    holding a key or an HTTP client.
//   openai, anthropic  declared and not wired. The evaluation transport, the
//                    separate evaluation keys and the dated model snapshots
//                    (decision 4) belong to the activation work; naming one now is
//                    a usage error that says so, never a silent fake.

import { z } from 'zod/v4'
import type { EvaluationOutcome, EvaluationProvider } from './review-analysis-v3-provider'
import {
  TestSetError,
  parseJsonLines,
  type ScoredItem,
  type TestSet,
} from './review-analysis-v3-testset'

export const FAKE_GOLD_PROVIDER_ID = 'fake-gold'
const ANSWERS_PREFIX = 'answers:'
const MAX_REPORTED_PROBLEMS = 20
const DECLARED_REAL_PROVIDERS = Object.freeze(['openai', 'anthropic'] as const)

/** The command named a provider it cannot run; the message says how to proceed. */
export class EvaluationProviderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EvaluationProviderError'
  }
}

const answerRowSchema = z.object({ id: z.string().min(1), answer: z.json() }).strict()

/** A fake that answers each item with its gold label, without the bookkeeping fields. */
export function createGoldEchoProvider(
  scored: readonly ScoredItem[],
): EvaluationProvider {
  const answers = new Map<string, unknown>(
    scored.map(({ gold }) => {
      const { id: _id, gold_source: _source, ...answer } = gold
      return [gold.id, answer] as const
    }),
  )
  return Object.freeze({
    id: FAKE_GOLD_PROVIDER_ID,
    model: 'fake-gold-echo',
    analyze: async (request): Promise<EvaluationOutcome> => {
      const answer = answers.get(request.itemId)
      return answer === undefined
        ? { status: 'failed', latencyMillis: 0 }
        : { status: 'answered', answer: structuredClone(answer), latencyMillis: 0 }
    },
  })
}

/** Rows of recorded answers by item id. A row is read once; a repeated id is an error. */
export function parseAnswerRows(
  label: string,
  source: string,
): ReadonlyMap<string, unknown> {
  const answers = new Map<string, unknown>()
  const problems: string[] = []
  try {
    for (const row of parseJsonLines(label, source, answerRowSchema)) {
      if (answers.has(row.id))
        problems.push(`${label}: ${row.id}: the id is answered twice`)
      else answers.set(row.id, row.answer)
    }
  } catch (error) {
    if (!(error instanceof TestSetError)) throw error
    problems.push(...error.problems)
  }
  if (problems.length > 0) {
    throw new EvaluationProviderError(
      [
        `${label} is not a file of answers`,
        ...problems.slice(0, MAX_REPORTED_PROBLEMS),
      ].join('\n'),
    )
  }
  return answers
}

/** Replay recorded answers; an item with no row is a failed call. */
export function createAnswerFileProvider(
  label: string,
  answers: ReadonlyMap<string, unknown>,
): EvaluationProvider {
  return Object.freeze({
    id: `${ANSWERS_PREFIX}${label}`,
    model: `recorded-answers:${label}`,
    analyze: async (request): Promise<EvaluationOutcome> => {
      if (!answers.has(request.itemId)) return { status: 'failed', latencyMillis: 0 }
      return {
        status: 'answered',
        answer: structuredClone(answers.get(request.itemId)),
        latencyMillis: 0,
      }
    },
  })
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function providerFor(
  name: string,
  testSet: TestSet,
  readFile: (path: string) => string,
): EvaluationProvider {
  if (name === FAKE_GOLD_PROVIDER_ID) return createGoldEchoProvider(testSet.scored)
  if (name.startsWith(ANSWERS_PREFIX)) {
    const path = name.slice(ANSWERS_PREFIX.length)
    if (path === '') throw new EvaluationProviderError('answers: needs a file path')
    return createAnswerFileProvider(
      baseName(path),
      parseAnswerRows(baseName(path), readFile(path)),
    )
  }
  if ((DECLARED_REAL_PROVIDERS as readonly string[]).includes(name)) {
    throw new EvaluationProviderError(
      `${name} is not wired into this command. It needs the evaluation transport, a ` +
        'separate evaluation key and the dated model snapshot (contract section 8, ' +
        'decision 4). Run the provider with a governed tool and score its recorded ' +
        `answers with answers:<file> instead.`,
    )
  }
  throw new EvaluationProviderError(
    `unknown provider '${name}'. Use ${FAKE_GOLD_PROVIDER_ID}, answers:<file>, ` +
      `${DECLARED_REAL_PROVIDERS.join(' or ')}.`,
  )
}

/** Turn `--providers a,b` into providers, or throw a message fit for the terminal. */
export function resolveProviders(
  spec: string,
  context: Readonly<{ testSet: TestSet; readFile: (path: string) => string }>,
): readonly EvaluationProvider[] {
  const names = spec
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '')
  if (names.length === 0) throw new EvaluationProviderError('no provider was named')
  const providers = names.map((name) =>
    providerFor(name, context.testSet, context.readFile),
  )
  const ids = providers.map((provider) => provider.id)
  if (new Set(ids).size !== ids.length) {
    throw new EvaluationProviderError('a provider was named twice')
  }
  return Object.freeze(providers)
}
