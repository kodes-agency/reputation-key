// Storybook mock helper — produces a callable shaped like a raw server fn
// reference, so stories can render prop-receiving components without RPC or a
// live server. Pass `mockServerFn(async (input) => result)` as the prop.

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
