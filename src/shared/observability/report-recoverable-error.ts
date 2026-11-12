type RecoverableErrorInfo = Readonly<{ componentStack?: string | null }>

/**
 * React's `onRecoverableError` for the browser root. It reports the error the way
 * React does by default, and also names the components the render was inside, so
 * a hydration mismatch (a minified React #418 carries no text) says where it was.
 */
export function reportRecoverableError(error: unknown, info: RecoverableErrorInfo): void {
  if (typeof globalThis.reportError === 'function') globalThis.reportError(error)
  else console.error(error)
  if (info.componentStack) {
    console.warn('React recovered from a render error in:', info.componentStack)
  }
}
