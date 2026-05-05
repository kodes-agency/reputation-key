// Integration context — domain rules

import type { GoogleConnectionVisibility } from './types'

const VALID_VISIBILITIES: ReadonlySet<string> = new Set(['private', 'organization'])

export const isValidVisibility = (v: string): v is GoogleConnectionVisibility =>
  VALID_VISIBILITIES.has(v)
