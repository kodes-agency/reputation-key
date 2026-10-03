import { useReducer } from 'react'
import type { Action } from '#/components/hooks/use-action'

/**
 * An Action that refuses every call and holds its error the way a mutation
 * does: the error it held is still there until a call replaces it with a new
 * one. `earlier` is a refusal left over from the last time a dialog was open,
 * which the dialog must not show before the person has tried again.
 */
export function useRefusingAction<TInput = never>(
  refuse: () => Error,
  earlier: unknown = null,
): Action<TInput> {
  const [error, setError] = useReducer((_held: unknown, next: unknown) => next, earlier)
  const call = async (_input: TInput): Promise<never> => {
    const refusal = refuse()
    setError(refusal)
    throw refusal
  }
  return Object.assign(call, { isPending: false, error, isSuccess: false, data: null })
}
