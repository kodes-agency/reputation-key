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
import type { Action } from './use-action'

export interface ActionMutationOptions<TInput, TOutput> {
  /** Shown via toast.success on success. Omit for a silent mutation. */
  successMessage?: string
  /** Query keys to invalidate on success (targeted — never router.invalidate()). */
  invalidateKeys?: QueryKey[]
  /** Runs AFTER invalidation + toast. Receives the output + the submitted input. */
  onSuccess?: (output: TOutput, input: TInput) => void | Promise<void>
  /** Navigate after success (create-and-redirect flows build params from output). */
  navigateTo?: {
    to: string
    params?: (output: TOutput) => Record<string, string>
  }
}

export function useActionMutation<TInput, TOutput>(
  fn: (input: TInput) => Promise<TOutput>,
  options?: ActionMutationOptions<TInput, TOutput>,
): Action<TInput, TOutput> {
  const qc = useQueryClient()
  const router = useRouter()
  const { successMessage, invalidateKeys, onSuccess, navigateTo } = options ?? {}

  const mutation = useMutation({
    mutationFn: (input: TInput) => fn(input),
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
