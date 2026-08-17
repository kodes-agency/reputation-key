const LEASE_ERROR = 'Sensitive source lease is disposed'

type MutableRecord = Record<string, unknown>

function isMutableRecord(value: unknown): value is MutableRecord {
  return typeof value === 'object' && value !== null
}

function nullMutableFields(value: unknown): void {
  if (!isMutableRecord(value)) return
  let keys: string[]
  try {
    keys = Object.keys(value)
  } catch {
    return
  }
  for (const key of keys) {
    try {
      value[key] = null
    } catch {
      // Releasing the lease reference remains authoritative for an immutable or hostile root.
    }
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as Readonly<{ then?: unknown }>).then === 'function'
  )
}

export type SensitiveSourceLeaseInspection = Readonly<{
  disposed: boolean
  hasSource: boolean
  ownedChunkCount: number
  allOwnedChunksZeroed: boolean
}>

export class SensitiveSourceLease<Source extends object = Record<string, unknown>> {
  readonly #ownedChunks: Uint8Array[] = []
  #source: Source | null = null
  #sensitiveRoot: object | null = null
  #disposed = false

  attachSource(
    source: Source,
    selectSensitiveRoot: (source: Source) => object = (value) => value,
  ): void {
    if (this.#disposed || this.#source !== null) throw new Error(LEASE_ERROR)
    const sensitiveRoot = selectSensitiveRoot(source)
    if (!isMutableRecord(sensitiveRoot))
      throw new TypeError('Sensitive source root is invalid')
    this.#source = source
    this.#sensitiveRoot = sensitiveRoot
  }

  registerOwnedChunk(chunk: Uint8Array): void {
    if (this.#disposed) {
      chunk.fill(0)
      throw new Error(LEASE_ERROR)
    }
    this.#ownedChunks.push(chunk)
  }

  read<Result>(consumer: (source: Source) => Result): Result {
    if (this.#disposed || this.#source === null) throw new Error(LEASE_ERROR)
    try {
      const result = consumer(this.#source)
      if (isThenable(result)) {
        throw new TypeError('Sensitive source consumer must be synchronous')
      }
      return result
    } finally {
      this.dispose()
    }
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    const sensitiveRoot = this.#sensitiveRoot
    this.#source = null
    this.#sensitiveRoot = null
    try {
      if (sensitiveRoot !== null) nullMutableFields(sensitiveRoot)
    } finally {
      for (const chunk of this.#ownedChunks) {
        try {
          chunk.fill(0)
        } catch {
          // Continue clearing every remaining owned chunk; disposal never propagates.
        }
      }
    }
  }

  inspect(): SensitiveSourceLeaseInspection {
    return Object.freeze({
      disposed: this.#disposed,
      hasSource: this.#source !== null,
      ownedChunkCount: this.#ownedChunks.length,
      allOwnedChunksZeroed: this.#ownedChunks.every((chunk) =>
        chunk.every((byte) => byte === 0),
      ),
    })
  }
}

export function createSensitiveSourceLease<
  Source extends object = Record<string, unknown>,
>(): SensitiveSourceLease<Source> {
  return new SensitiveSourceLease<Source>()
}
