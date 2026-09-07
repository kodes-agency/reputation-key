class Ok<T, E> {
  constructor(readonly value: T) {}

  isOk(): this is Ok<T, E> {
    return true
  }
  isErr(): this is Err<T, E> {
    return false
  }
  map<U>(mapper: (value: T) => U): Result<U, E> {
    return ok<U, E>(mapper(this.value))
  }
  match<U, V>(onOk: (value: T) => U, _onErr: (error: E) => V): U | V {
    return onOk(this.value)
  }
  _unsafeUnwrap(): T {
    return this.value
  }
  _unsafeUnwrapErr(): E {
    throw new Error('Cannot unwrap an error from an Ok result')
  }
}

class Err<T, E> {
  constructor(readonly error: E) {}

  isOk(): this is Ok<T, E> {
    return false
  }
  isErr(): this is Err<T, E> {
    return true
  }
  map<U>(_mapper: (value: T) => U): Result<U, E> {
    return this as unknown as Err<U, E>
  }
  match<U, V>(_onOk: (value: T) => U, onErr: (error: E) => V): U | V {
    return onErr(this.error)
  }
  _unsafeUnwrap(): T {
    throw this.error
  }
  _unsafeUnwrapErr(): E {
    return this.error
  }
}

export type Result<T, E> = Ok<T, E> | Err<T, E>

export function ok<T, E = never>(value: T): Ok<T, E> {
  return new Ok<T, E>(value)
}

export function err<T = never, E = unknown>(error: E): Err<T, E> {
  return new Err<T, E>(error)
}
type ResultValue<R> =
  R extends Ok<infer T, unknown> ? T : R extends Err<infer T, unknown> ? T : never
type ResultError<R> =
  R extends Ok<unknown, infer E> ? E : R extends Err<unknown, infer E> ? E : never

function combine<T extends readonly Result<unknown, unknown>[]>(
  results: readonly [...T],
): Result<{ [K in keyof T]: ResultValue<T[K]> }, ResultError<T[number]>>
function combine(
  results: readonly Result<unknown, unknown>[],
): Result<unknown[], unknown> {
  const values: unknown[] = []
  for (const result of results) {
    if (result.isErr()) return err(result.error)
    values.push(result.value)
  }
  return ok(values)
}

export const Result = Object.freeze({ combine })
