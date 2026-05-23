// Logger port — application-layer logging abstraction.
// Decouples use cases from pino, allowing any logger that satisfies this interface.
// Infrastructure provides the pino adapter; tests use the shared mock-logger.

export interface LoggerPort {
  info(msg: string, ...args: unknown[]): void
  info(obj: object, msg?: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  warn(obj: object, msg?: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
  error(obj: object, msg?: string, ...args: unknown[]): void
  debug(msg: string, ...args: unknown[]): void
  debug(obj: object, msg?: string, ...args: unknown[]): void
  child(bindings: Record<string, unknown>): LoggerPort
}
