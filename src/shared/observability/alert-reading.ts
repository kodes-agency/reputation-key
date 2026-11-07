import type { AlertFacts } from './alert-facts'

/** Content-free breach reading, with limits supplied by the snapshot when configured. */
export type AlertReading = Readonly<{
  value: number
  detail: string
  facts?: AlertFacts
  threshold?: number
  windowMs?: number
}>
