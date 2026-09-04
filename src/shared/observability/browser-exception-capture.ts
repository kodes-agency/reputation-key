export type BrowserExceptionCapture = (error: unknown) => void

let capture: BrowserExceptionCapture | undefined

export function captureBrowserException(error: unknown): void {
  capture?.(error)
}

export function setBrowserExceptionCapture(nextCapture?: BrowserExceptionCapture): void {
  capture = nextCapture
}
