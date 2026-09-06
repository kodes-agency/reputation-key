// Browser stub for #/shared/observability/logger.
//
// The real module (src/shared/observability/logger.ts) returns a pino logger and
// calls require.resolve('pino-pretty'); pino + better-auth's ALS pull Node
// builtins that crash the Storybook preview. Shared modules reachable from the
// in-memory container import it lazily on failure paths; this stub keeps those
// paths from crashing the preview.
//
// Aliased ONLY in the Storybook Vite build (.storybook/main.ts viteFinal); tsc
// still resolves the real module for type-checking.
const noop = () => {}
type ConsoleLogger = ((...args: unknown[]) => void) & {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
  trace: (...args: unknown[]) => void
  fatal: (...args: unknown[]) => void
  child: () => ConsoleLogger
}

const consoleLogger: ConsoleLogger = Object.assign(
  (...args: unknown[]) => console.info('[storybook:logger]', ...args),
  {
    info: (...args: unknown[]) => console.info('[storybook:logger]', ...args),
    warn: (...args: unknown[]) => console.warn('[storybook:logger]', ...args),
    error: (...args: unknown[]) => console.error('[storybook:logger]', ...args),
    debug: noop,
    trace: noop,
    fatal: (...args: unknown[]) => console.error('[storybook:logger]', ...args),
    child: () => consoleLogger,
  },
)

export function getLogger() {
  return consoleLogger
}
