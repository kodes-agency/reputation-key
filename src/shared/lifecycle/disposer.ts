// The one release sequence the web plugin, the worker drain and the container's
// own disposer share: ordered stages, one optional deadline, every failure kept.

export type DisposalHook = Readonly<{
  label: string
  release: () => void | Promise<unknown>
}>

/**
 * `failed` names the hooks whose release rejected. `stuck` names the hooks that
 * had not finished when the deadline expired, including the ones never started.
 */
export type DisposalResult = Readonly<{
  timedOut: boolean
  stuck: readonly string[]
  failed: readonly string[]
}>

/**
 * Release ordered stages under one deadline. The hooks of a stage run together
 * (a stage may drain peers at once); the next stage starts when the whole stage
 * has settled. A rejecting hook is reported through `onError` and in `failed`,
 * and never stops the stages behind it. Once `budgetMs` expires no further stage
 * starts; the unfinished hooks are returned in `stuck`. Without `budgetMs` the
 * caller's own deadline applies. Never throws.
 */
export async function disposeResources(
  stages: readonly (readonly DisposalHook[])[],
  options: {
    budgetMs?: number
    onError?: (error: unknown, label: string) => void
  } = {},
): Promise<DisposalResult> {
  const pending = new Set(stages.flat())
  const failed: string[] = []
  let expired = false
  const loop = async () => {
    for (const stage of stages) {
      if (expired) break
      await Promise.all(
        stage.map(async (hook) => {
          try {
            await hook.release()
          } catch (error) {
            failed.push(hook.label)
            options.onError?.(error, hook.label)
          } finally {
            pending.delete(hook)
          }
        }),
      )
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const budget =
    options.budgetMs === undefined
      ? new Promise<never>(() => {})
      : new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            expired = true
            resolve()
          }, options.budgetMs)
        })
  try {
    await Promise.race([loop(), budget])
    return {
      timedOut: expired,
      stuck: [...pending].map((hook) => hook.label),
      failed: [...failed],
    }
  } finally {
    clearTimeout(timer)
  }
}
