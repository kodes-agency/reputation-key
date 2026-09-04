// ARC-01 command-context boundary for non-HTTP command entry points.
// shared/ops deliberately cannot depend on shared/observability, so this
// outbox-owned seam installs the command identity in the RequestContext that
// durable fact committers read.

import { runWithContext } from '#/shared/observability/request-context'

export function runWithCommandContext<T>(
  commandId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return runWithContext(commandId, fn, { commandId })
}
