import { replyDraftingV2OutputSchema } from '#/shared/reply-drafting-v2-schema'
import {
  reportReplyProgress,
  type ReplyDraftingProgressSink,
} from '#/shared/reply-drafting-progress'

const FIELDS = ['languageCode', 'case', 'mainPoint', 'avoidTerms', 'replyText'] as const

/**
 * An ordered JSON prefix scanner, never a repaired/guessed partial JSON parse.
 * Complete fields are parsed with JSON.parse and the final answer's own schema.
 * Unknown order or malformed prefixes simply suppress further progress; the final
 * strict parser still decides acceptance. Nothing from a string field is emitted.
 */
export function createReplyProgressParser(
  sentenceNumbers: readonly number[],
  sink?: ReplyDraftingProgressSink,
) {
  const validNumbers = new Set(sentenceNumbers)
  let field = ''
  let fieldIndex = 0
  let depth = 0
  let quoted = false
  let escaped = false
  let started = false
  let invalid = false
  let writing = false
  let bytes = 0

  const completeField = () => {
    const key = FIELDS[fieldIndex]
    try {
      const parsed = JSON.parse(`{${field}}`) as Record<string, unknown>
      if (!key || Object.keys(parsed).length !== 1 || !Object.hasOwn(parsed, key)) {
        invalid = true
        return
      }
      const result = replyDraftingV2OutputSchema.shape[key].safeParse(parsed[key])
      if (!result.success) {
        invalid = true
        return
      }
      if (key === 'mainPoint') {
        const numbers = result.data as number[]
        if (!numbers.every((n) => validNumbers.has(n))) {
          invalid = true
          return
        }
        reportReplyProgress(sink, { step: 'answering', sentenceNumbers: numbers })
      }
      fieldIndex += 1
      field = ''
    } catch {
      invalid = true
    }
  }

  const consume = (character: string): void => {
    if (!started) {
      if (/\s/u.test(character)) return
      if (character !== '{') {
        invalid = true
        return
      }
      started = true
      depth = 1
      return
    }
    if (!quoted && depth === 1 && (character === ',' || character === '}')) {
      completeField()
      if (character === '}') invalid = true
      return
    }
    field += character
    if (escaped) {
      escaped = false
      return
    }
    if (quoted && character === '\\') {
      escaped = true
      return
    }
    if (character === '"') quoted = !quoted
    if (!quoted) depth += nestingChange(character)
    if (!writing && fieldIndex === 4 && hasFirstReplyCharacter(field)) {
      writing = true
      reportReplyProgress(sink, { step: 'writing' })
    }
  }
  return (delta: string): void => {
    bytes += new TextEncoder().encode(delta).byteLength
    if (bytes > 16_384) invalid = true
    for (const character of delta) {
      if (invalid) return
      consume(character)
    }
  }
}

function nestingChange(character: string): number {
  if (character === '{' || character === '[') return 1
  return character === '}' || character === ']' ? -1 : 0
}

function hasFirstReplyCharacter(field: string): boolean {
  const prefix = /^\s*"replyText"\s*:\s*"/u.exec(field)
  if (!prefix) return false
  const value = field.slice(prefix[0].length)
  if (!value.length) return false
  if (value[0] === '\\') return /^\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})/u.test(value)
  return value[0] !== '"' && value.charCodeAt(0) >= 0x20
}
