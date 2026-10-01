// Storybook mock helpers — produce the callables components receive as props, so
// stories can render them without RPC or a live server. `mockServerFn` is shaped
// like a raw server fn reference (`mockServerFn(async (input) => result)`);
// `mockAction` is shaped like the reactive `Action` that `useAction` returns.

import type { Action } from '#/components/hooks/use-action'

/**
 * Wrap an impl into a server-fn-shaped callable. Use for components that receive
 * a raw server fn reference as a prop (the post-Phase-1 fn-as-prop pattern) —
 * the story passes `mockServerFn(async (input) => result)`.
 */
export function mockServerFn<TInput, TOutput>(
  impl: (input: TInput) => TOutput | Promise<TOutput>,
): (input: TInput) => Promise<TOutput> {
  return async (input: TInput) => impl(input)
}

/** The reactive state an `Action` carries beside the call itself. */
export type MockActionState = Readonly<{
  isPending?: boolean
  error?: unknown
  isSuccess?: boolean
}>

/**
 * An `Action` in any state a story needs, without a live server. Pass a plain
 * function as `impl`, not `fn()`, when the story asserts on a rejection: the
 * spy attaches its own handler to every promise it returns, which would mark
 * the rejection handled and hide exactly what the story looks for.
 */
export function mockAction<TInput, TOutput = unknown>(
  impl: (input: TInput) => Promise<TOutput> = async () => undefined as TOutput,
  state: MockActionState = {},
): Action<TInput, TOutput> {
  return Object.assign(impl, {
    isPending: state.isPending ?? false,
    error: state.error ?? null,
    isSuccess: state.isSuccess ?? false,
    data: null,
  })
}
