/**
 * The promise rejections nothing handled while `act` ran.
 *
 * An `Action` is mutateAsync-shaped, so a click handler that returns its promise
 * bare lets a refusal escape as an unhandled rejection, which the browser logs
 * and reports although the refusal was already shown. Node reports one once the
 * microtask queue has drained, so two macrotask turns are waited out first.
 *
 * Fake the Action with a plain async function, not `vi.fn()`: the spy attaches
 * its own handler to every promise it returns, which marks the rejection handled
 * and hides exactly what this looks for.
 */
export async function unhandledRejectionsDuring(act: () => unknown): Promise<unknown[]> {
  const unhandled: unknown[] = []
  const record = (reason: unknown) => {
    unhandled.push(reason)
  }
  process.on('unhandledRejection', record)
  try {
    act()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
  } finally {
    process.off('unhandledRejection', record)
  }
  return unhandled
}
