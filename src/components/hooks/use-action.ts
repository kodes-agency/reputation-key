import { useState, useCallback } from 'react'

/** Typed action result — callable like a function, with reactive state props.
 *
 * Use this to wrap server functions (or any async function) when you need
 * `isPending` and `error` for UI feedback (submit buttons, error banners).
 *
 * Example:
 *   const create = useAction(useServerFn(createPropertyServerFn))
 *   await create({ data: { name: 'X' } })
 *   create.isPending // boolean
 *   create.error     // Error | null
 */
export type Action<TInput, TOutput = unknown> = ((input: TInput) => Promise<TOutput>) & {
  isPending: boolean
  error: unknown
}

/** Broad action type for form components that accept any mutation shape.
 * Any `Action<Specific>` is assignable to `AnyAction`.
 * eslint-disable: `any` is required here to create a universal function type.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAction = ((...args: any[]) => Promise<unknown>) & {
  isPending: boolean
  error: unknown
}

/** Wrap an async function with pending/error state.
 *
 * Designed to be layered over `useServerFn` (or any async function).
 * Returns a callable object so it can be passed directly to form components
 * that expect `mutation: Action<TInput>`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useAction<TFn extends (input: any) => Promise<any>>(
  fn: TFn,
): Action<Parameters<TFn>[0], Awaited<ReturnType<TFn>>> {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const execute = useCallback(
    async (input: Parameters<TFn>[0]): Promise<Awaited<ReturnType<TFn>>> => {
      setIsPending(true)
      setError(null)
      try {
        const result = (await fn(input)) as Awaited<ReturnType<TFn>>
        return result
      } catch (err) {
        setError(err)
        throw err
      } finally {
        setIsPending(false)
      }
    },
    [fn],
  )

  return Object.assign(execute, { isPending, error })
}

/** Wrap an action with a post-execution side effect.
 *
 * Returns a new Action whose `isPending`/`error` are delegated to the original.
 * Useful when a form component needs to trigger navigation or invalidation
 * after the server function succeeds.
 */
export function wrapAction<TInput, TOutput>(
  action: Action<TInput, TOutput>,
  after: (output: TOutput) => void | Promise<void>,
): Action<TInput, TOutput> {
  const wrapped = async (input: TInput): Promise<TOutput> => {
    const result = await action(input)
    await after(result)
    return result
  }
  return Object.assign(wrapped, {
    get isPending() {
      return action.isPending
    },
    get error() {
      return action.error
    },
  }) as Action<TInput, TOutput>
}
