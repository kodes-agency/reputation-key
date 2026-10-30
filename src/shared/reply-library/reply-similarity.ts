export const REPLY_DUPLICATE_SIMILARITY_THRESHOLD = 0.8 as const

const GREETINGS = new Set(['dear', 'hello', 'hi', 'hola'])

function normalizedTokens(value: string): string[] {
  const [firstLine = '', ...remainingLines] = value.toLocaleLowerCase().split(/\r?\n/u)
  const greetingTokens = firstLine.match(/\p{Letter}+/gu) ?? []
  const bodyTokens = remainingLines.join(' ').match(/\p{Letter}+/gu) ?? []
  if (!GREETINGS.has(greetingTokens[0] ?? '')) {
    return [...greetingTokens, ...bodyTokens]
  }
  const withoutGreetingAndName = greetingTokens.slice(greetingTokens.length > 1 ? 2 : 1)
  return [...withoutGreetingAndName, ...bodyTokens]
}

function trigrams(value: string): Set<string> {
  const tokens = normalizedTokens(value)
  const result = new Set<string>()
  for (let index = 0; index + 2 < tokens.length; index += 1) {
    result.add(`${tokens[index]}\0${tokens[index + 1]}\0${tokens[index + 2]}`)
  }
  return result
}

export function replySimilarity(left: string, right: string): number {
  const a = trigrams(left)
  const b = trigrams(right)
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const gram of a) if (b.has(gram)) intersection += 1
  return intersection / (a.size + b.size - intersection)
}

export function maxSimilarity(candidate: string, recentTexts: readonly string[]): number {
  let maximum = 0
  for (const text of recentTexts)
    maximum = Math.max(maximum, replySimilarity(candidate, text))
  return maximum
}
