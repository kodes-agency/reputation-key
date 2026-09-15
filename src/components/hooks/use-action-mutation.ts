/**
 * useActionMutation — Query-native replacement for useMutationAction.
 *
 * Wraps `useMutation` and returns the SAME `Action<TInput, TOutput>` shape that
 * the form/presentation components already consume (callable + `.isPending` /
 * `.error` / `.isSuccess` / `.data`). Every callsite becomes Query-native
 * (devtools visibility, `onMutate` optimistic updates available) WITHOUT touching
 * the ~29 Action-typed components.
 *
 * Invalidation is targeted Query keys (`invalidateKeys`) — never the
 * `router.invalidate()` sledgehammer. Server functions are called directly in
 * `mutationFn` (TanStack Start transforms them to RPCs — same as the route-loader
 * queryFns; no `useServerFn` wrap needed).
 *
 * Replaces BOTH `useMutationAction` (pass `successMessage` for a toast) and
 * `useMutationActionSilent` (omit `successMessage`).
 */
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { isServerFunctionError } from '#/shared/auth/server-function-error'
import type { Action } from './use-action'

/** What a failed action says when the server's own words cannot be shown. */
export const GENERIC_ACTION_ERROR_MESSAGE = 'Something went wrong. Try again.'

/**
 * The toast for a rejected action: the server's sentence for a 4xx refusal, a
 * generic one for anything else.
 *
 * A 4xx `ServerFunctionError` is a domain refusal whose message the context
 * wrote for the person who clicked (`throwContextError`, server-errors.ts:18,
 * sends `e.message` verbatim with the status the context mapped, e.g.
 * `reviewErrorStatus` in review/server/reply-read.ts). A 5xx or an untagged
 * error is a failure whose message was never written for a reader and may name
 * internal state, so it is replaced rather than shown. Recognition is by shape
 * (`isServerFunctionError`), because the class can load twice in dev.
 */
export function actionErrorMessage(error: unknown): string {
  if (isServerFunctionError(error) && error.status >= 400 && error.status < 500) {
    return error.message
  }
  return GENERIC_ACTION_ERROR_MESSAGE
}

export interface ActionMutationOptions<TInput, TOutput> {
  /** Shown via toast.success on success. Omit for a silent mutation. */
  successMessage?: string
  /**
   * Shown via toast.error when the mutation rejects (after any recovery). Omit
   * for a caller that reports failure itself. Pass `actionErrorMessage` for the
   * default wording, or a function of the error to special-case one refusal.
   *
   * Opt-in because `Action` is `mutateAsync`: every rejection also reaches the
   * caller, and a caller that already renders the error inline must not get a
   * second report. A caller that only guards the promise against an unhandled
   * rejection (`.catch(() => undefined)`) says nothing unless it opts in here.
   */
  errorMessage?: string | ((error: unknown) => string)
  /** Query keys to invalidate on success (targeted — never router.invalidate()). */
  invalidateKeys?: QueryKey[]
  /**
   * Optimistic cache write, run BEFORE the request. Return a thunk that undoes
   * it; the thunk runs if the mutation rejects. Return `undefined` when there
   * was nothing to roll back.
   *
   * Use this instead of awaiting the server and then invalidating: with
   * `staleTime: 0` the round trip is visible as a lagging row.
   */
  optimistic?: (input: TInput) => (() => void) | undefined
  /**
   * Recover a rejected mutation once: return a rebuilt input to resubmit, or
   * null to let the rejection stand. The domain owns the decision and message.
   */
  recover?: (input: TInput, error: unknown) => Promise<TInput | null>
  /** Runs AFTER invalidation + toast. Receives the output + the submitted input. */
  onSuccess?: (output: TOutput, input: TInput) => void | Promise<void>
  /**
   * Runs after a rejection's rollback and toast, with the SUBMITTED input — for
   * a caller whose cache may be what the refusal is about. Like `onSuccess`,
   * it reaches a mutation still pending when the options change, so it must
   * act on the input, not on whatever the caller's closure has open by then.
   */
  onError?: (error: unknown, input: TInput) => void
  /** Navigate after success (create-and-redirect flows build params from output). */
  navigateTo?: {
    to: string
    params?: (output: TOutput) => Record<string, string>
  }
}

/** What `onMutate` hands to `onError` so a failed mutation can be undone. */
type Rollback = Readonly<{ undo: (() => void) | undefined }>

export function useActionMutation<TInput, TOutput>(
  fn: (input: TInput) => Promise<TOutput>,
  options?: ActionMutationOptions<TInput, TOutput>,
): Action<TInput, TOutput> {
  const qc = useQueryClient()
  const router = useRouter()
  const {
    successMessage,
    errorMessage,
    invalidateKeys,
    optimistic,
    onSuccess,
    navigateTo,
  } = options ?? {}

  const mutation = useMutation<TOutput, Error, TInput, Rollback>({
    mutationFn: async (input) => {
      try {
        return await fn(input)
      } catch (error) {
        if (!options?.recover) throw error
        const recoveredInput = await options.recover(input, error)
        if (recoveredInput === null) throw error
        return fn(recoveredInput)
      }
    },
    onMutate: (input) => ({ undo: optimistic?.(input) }),
    // The optimistic write is undone only on failure; on success the
    // invalidation below reconciles it against the server.
    onError: (error, input, context) => {
      context?.undo?.()
      if (errorMessage !== undefined) {
        toast.error(typeof errorMessage === 'string' ? errorMessage : errorMessage(error))
      }
      options?.onError?.(error, input)
    },
    onSuccess: async (output, input) => {
      if (invalidateKeys && invalidateKeys.length > 0) {
        await Promise.all(
          invalidateKeys.map((key) => qc.invalidateQueries({ queryKey: key })),
        )
      }
      if (successMessage) toast.success(successMessage)
      await onSuccess?.(output, input)
      if (navigateTo) {
        await router.navigate({
          to: navigateTo.to,
          params: navigateTo.params?.(output),
        })
      }
    },
  })

  // mutateAsync is stable across renders; attach fresh reactive state each render
  // (same construction strategy as useAction in ./use-action.ts). The plain
  // assignment is type-safe: a fn with an optional 2nd `options` arg is assignable
  // to the single-arg callable in `Action`.
  const callable: (input: TInput) => Promise<TOutput> = mutation.mutateAsync
  return Object.assign(callable, {
    isPending: mutation.isPending,
    error: mutation.error,
    isSuccess: mutation.isSuccess,
    data: mutation.data ?? null,
  })
}
