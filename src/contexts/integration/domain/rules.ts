// Integration context — domain rules

import type { GoogleConnectionVisibility } from './types'

const VALID_VISIBILITIES: ReadonlySet<string> = new Set(['private', 'organization'])

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export const isValidEmail = (email: string): boolean => EMAIL_RE.test(email)

export const isValidVisibility = (v: string): v is GoogleConnectionVisibility =>
  VALID_VISIBILITIES.has(v)
