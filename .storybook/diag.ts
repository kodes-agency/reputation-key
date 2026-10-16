// DIAG (temporary, diag branch only). The breadcrumb listeners and the
// document MutationObserver that used to live here made the hang disappear
// (0 hangs in 468 runs of the file against ~1 in 80 without them), so this
// run keeps only inert entry points and relies on the watchdog's Chrome trace.
export function diag(message: string): string {
  return message
}

export function diagFor(on: boolean): boolean {
  return on
}
