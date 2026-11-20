// Browser-safe access to the recommendation's number grid and own-number note
// (ADR 0068). Exact usuals cross JSON as decimal integers, since JSON has no BigInt.

export { goalStepDown, goalStepUp, ownNumberNote } from '../domain/goal-number-steps'
