// Monthly portal goal — the number box's steps and the note an own number gets,
// for the set sheet (pure, client-safe; ADR 0068 decision 4).
//
// The − and + of the box move along the same grid the recommended number is
// rounded onto, and an own number is measured against the month's exact usual
// (the card read sends it as decimal integers in lowest terms: JSON has no
// BigInt). Components import Reporting's values from here, never from the
// domain (the components boundary in eslint.config.js).
export { goalStepDown, goalStepUp, ownNumberNote } from '../domain/goal-number-steps'
