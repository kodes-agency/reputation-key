import type { DomainError } from './errors'

export const isDomainError = (e: unknown): e is DomainError =>
  typeof e === 'object' && e !== null && '_tag' in e && e._tag === 'DomainError'
