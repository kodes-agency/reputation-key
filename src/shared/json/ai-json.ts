export const AI_JSON_MAX_BYTES = 131_072 as const

const INTERNAL_ERROR = 'AI internal request is invalid'

export const AI_INTERNAL_JSON_MAX_DEPTH = 64 as const
export const AI_INTERNAL_JSON_MAX_NODES = 10_000 as const

function fail(): never {
  throw new TypeError(INTERNAL_ERROR)
}

export function hasOnlyUnicodeScalars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (index + 1 >= value.length) return false
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return false
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false
    }
  }
  return true
}

/**
 * `safe-integers` is the internal-transport invariant: our own services encode
 * every number as a safe integer, so anything fractional is a defect or an
 * injection. `finite-numbers` is for third-party provider bodies, which
 * legitimately echo fractional sampling parameters such as `top_p`.
 */
type AiJsonNumberPolicy = 'safe-integers' | 'finite-numbers'

function scalarViolation(
  entry: unknown,
  numbers: AiJsonNumberPolicy,
  path: string,
): string | null {
  if (typeof entry === 'string') {
    return hasOnlyUnicodeScalars(entry) ? 'ok' : `string_surrogate:${path}`
  }
  if (typeof entry === 'number') {
    if (!Number.isFinite(entry)) return `number_not_finite:${path}`
    if (numbers === 'safe-integers' && !Number.isSafeInteger(entry)) {
      return `number_not_integer:${path}=${String(entry)}`
    }
    return 'ok'
  }
  return entry === null || typeof entry === 'boolean' ? 'ok' : null
}

function inspectParsedJson(value: unknown, numbers: AiJsonNumberPolicy) {
  let nodeCount = 0
  let violation = 'ok'
  const visitObject = (entry: object, depth: number, path: string): boolean => {
    for (const [key, child] of Object.entries(entry)) {
      if (!hasOnlyUnicodeScalars(key)) {
        violation = `key_surrogate:${path}.${key.length}ch`
        return false
      }
      if (!visit(child, depth + 1, `${path}.${key}`)) return false
    }
    return true
  }
  const visit = (entry: unknown, depth: number, path: string): boolean => {
    nodeCount += 1
    if (depth > AI_INTERNAL_JSON_MAX_DEPTH) {
      violation = `depth:${path}`
      return false
    }
    if (nodeCount > AI_INTERNAL_JSON_MAX_NODES) {
      violation = `nodes:${path}`
      return false
    }
    const scalar = scalarViolation(entry, numbers, path)
    if (scalar !== null) {
      violation = scalar
      return scalar === 'ok'
    }
    if (Array.isArray(entry)) {
      return entry.every((child, index) => visit(child, depth + 1, `${path}[${index}]`))
    }
    if (
      entry === null ||
      typeof entry !== 'object' ||
      Object.getPrototypeOf(entry) !== Object.prototype
    ) {
      violation = `prototype:${path}`
      return false
    }
    return visitObject(entry, depth, path)
  }
  visit(value, 1, '$')
  return { violation, nodeCount }
}

function isJsonWhitespace(code: number): boolean {
  return code === 0x09 || code === 0x0a || code === 0x0d || code === 0x20
}

function scanDigits(raw: string, start: number): number {
  let cursor = start
  while (raw.charCodeAt(cursor) >= 0x30 && raw.charCodeAt(cursor) <= 0x39) cursor += 1
  return cursor
}

function scanRequiredDigits(raw: string, start: number): number | null {
  const end = scanDigits(raw, start)
  return end === start ? null : end
}

function scanJsonExponent(raw: string, start: number): number | null {
  const exponent = raw.charCodeAt(start)
  if (exponent !== 0x45 && exponent !== 0x65) return start
  let cursor = start + 1
  const sign = raw.charCodeAt(cursor)
  if (sign === 0x2b || sign === 0x2d) cursor += 1
  return scanRequiredDigits(raw, cursor)
}

function scanJsonNumber(raw: string, start: number): number | null {
  let cursor = start
  if (raw.charCodeAt(cursor) === 0x2d) cursor += 1
  const first = raw.charCodeAt(cursor)
  if (first === 0x30) {
    cursor += 1
  } else if (first >= 0x31 && first <= 0x39) {
    cursor = scanDigits(raw, cursor + 1)
  } else {
    return null
  }
  if (raw.charCodeAt(cursor) === 0x2e) {
    const fractionEnd = scanRequiredDigits(raw, cursor + 1)
    if (fractionEnd === null) return null
    cursor = fractionEnd
  }
  return scanJsonExponent(raw, cursor)
}

function scanStrictJson(raw: string): void {
  let offset = 0
  let nodeCount = 0
  const skipWhitespace = () => {
    while (offset < raw.length && isJsonWhitespace(raw.charCodeAt(offset))) offset += 1
  }
  const scanEscape = (): void => {
    offset += 1
    const escape = raw[offset]
    if (escape === 'u') {
      if (!/^[0-9a-fA-F]{4}$/u.test(raw.slice(offset + 1, offset + 5))) fail()
      offset += 5
      return
    }
    if (escape === undefined || !'"\\/bfnrt'.includes(escape)) fail()
    offset += 1
  }
  const scanString = (): string => {
    const start = offset
    if (raw[offset] !== '"') fail()
    offset += 1
    while (offset < raw.length) {
      const code = raw.charCodeAt(offset)
      if (code === 0x22) {
        offset += 1
        const value = JSON.parse(raw.slice(start, offset)) as unknown
        if (typeof value !== 'string' || !hasOnlyUnicodeScalars(value)) fail()
        return value
      }
      if (code < 0x20) fail()
      if (code === 0x5c) scanEscape()
      else offset += 1
    }
    fail()
  }
  const scanObject = (depth: number): void => {
    offset += 1
    skipWhitespace()
    const keys = new Set<string>()
    if (raw.charCodeAt(offset) === 0x7d) {
      offset += 1
      return
    }
    while (offset < raw.length) {
      skipWhitespace()
      const key = scanString()
      if (keys.has(key)) fail()
      keys.add(key)
      skipWhitespace()
      if (raw.charCodeAt(offset) !== 0x3a) fail()
      offset += 1
      scanValue(depth + 1)
      skipWhitespace()
      if (raw.charCodeAt(offset) === 0x7d) {
        offset += 1
        return
      }
      if (raw.charCodeAt(offset) !== 0x2c) fail()
      offset += 1
    }
    fail()
  }
  const scanArray = (depth: number): void => {
    offset += 1
    skipWhitespace()
    if (raw.charCodeAt(offset) === 0x5d) {
      offset += 1
      return
    }
    while (offset < raw.length) {
      scanValue(depth + 1)
      skipWhitespace()
      if (raw.charCodeAt(offset) === 0x5d) {
        offset += 1
        return
      }
      if (raw.charCodeAt(offset) !== 0x2c) fail()
      offset += 1
    }
    fail()
  }
  const scanLiteralOrNumber = (): void => {
    if (raw.startsWith('true', offset) || raw.startsWith('null', offset)) {
      offset += 4
      return
    }
    if (raw.startsWith('false', offset)) {
      offset += 5
      return
    }
    const numberEnd = scanJsonNumber(raw, offset)
    if (numberEnd === null) fail()
    offset = numberEnd
  }
  const scanValue = (depth: number): void => {
    nodeCount += 1
    if (depth > AI_INTERNAL_JSON_MAX_DEPTH || nodeCount > AI_INTERNAL_JSON_MAX_NODES) {
      fail()
    }
    skipWhitespace()
    switch (raw.charCodeAt(offset)) {
      case 0x22:
        scanString()
        return
      case 0x7b:
        scanObject(depth)
        return
      case 0x5b:
        scanArray(depth)
        return
      default:
        scanLiteralOrNumber()
    }
  }
  scanValue(1)
  skipWhitespace()
  if (offset !== raw.length) fail()
}

function parseStrictInternalJsonBytes<T>(
  bytes: Uint8Array,
  maxBytes: number,
  schema: Readonly<{ parse(value: unknown): T }>,
  numbers: AiJsonNumberPolicy = 'safe-integers',
): T {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 8 * 1024 * 1024 ||
    bytes.byteLength < 1 ||
    bytes.byteLength > maxBytes ||
    (bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
  ) {
    fail()
  }
  try {
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    scanStrictJson(raw)
    const value = JSON.parse(raw) as unknown
    if (inspectParsedJson(value, numbers).violation !== 'ok') fail()
    return schema.parse(value)
  } catch {
    fail()
  }
}

/**
 * Names the first violated rule and JSON path using the same scanner and
 * parsed-value checks as request parsing. Operator and canary diagnostics only.
 */
export function explainJsonBytesRejection(
  bytes: Uint8Array,
  maxBytes: number,
  numbers: AiJsonNumberPolicy = 'safe-integers',
): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 8 * 1024 * 1024) {
    return `max_bytes:${maxBytes}`
  }
  if (bytes.byteLength < 1 || bytes.byteLength > maxBytes) {
    return `byte_length:${bytes.byteLength}`
  }
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    return 'bom'
  }
  let raw: string
  try {
    raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return 'utf8'
  }
  let scan = 'scan:ok'
  try {
    scanStrictJson(raw)
  } catch {
    scan = 'scan:fail'
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return `${scan};parse:fail`
  }
  const { violation, nodeCount } = inspectParsedJson(parsed, numbers)
  return `${scan};parse:ok;validate:${violation};nodes:${nodeCount}`
}

export function parseAiInternalJsonBytes<T>(
  bytes: Uint8Array,
  maxBytes: number,
  schema: Readonly<{ parse(value: unknown): T }>,
): T {
  if (maxBytes > AI_JSON_MAX_BYTES) fail()
  return parseStrictInternalJsonBytes(bytes, maxBytes, schema)
}

/**
 * Provider response bodies get every internal rule — byte cap, fatal UTF-8, no
 * BOM, strict scan, no duplicate keys, depth and node caps, unicode scalars —
 * except integers-only: a provider legitimately echoes fractional sampling
 * parameters (`top_p`), and rejecting those turned a valid 200 into
 * `output_invalid`.
 */
export function parseAiProviderJsonBytes<T>(
  bytes: Uint8Array,
  maxBytes: number,
  schema: Readonly<{ parse(value: unknown): T }>,
): T {
  if (maxBytes > AI_JSON_MAX_BYTES) fail()
  return parseStrictInternalJsonBytes(bytes, maxBytes, schema, 'finite-numbers')
}
