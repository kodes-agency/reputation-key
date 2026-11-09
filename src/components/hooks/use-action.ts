/** Callable async command with reactive state for forms and presentation components. */
export type Action<TInput, TOutput = unknown> = ((input: TInput) => Promise<TOutput>) & {
  isPending: boolean
  error: unknown
  isSuccess: boolean
  data: TOutput | null
}

/** Broad action type for form components that accept any mutation shape.
 * Any `Action<Specific>` is assignable to `AnyAction`.
 * eslint-disable: `any` is required here to create a universal function type.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAction = ((...args: any[]) => Promise<unknown>) & {
  isPending: boolean
  error: unknown
  isSuccess: boolean
  data: unknown
}
