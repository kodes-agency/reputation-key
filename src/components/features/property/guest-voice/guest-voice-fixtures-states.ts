import { HAMPTON_READ } from './guest-voice-fixtures-check-in'
export { HAMPTON_READ as URGENT_READ } from './guest-voice-fixtures-check-in'
const first = HAMPTON_READ.urgent[0]
if (!first) throw new Error('The concern fixture must have an urgent issue')
export const RAILING_ISSUE = first
