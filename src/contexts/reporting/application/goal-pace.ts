// Monthly portal goal — the pace rule, for the change sheet (pure, client-safe;
// PLAN E12, E13). The sheet's one judgement of its own: whether a number typed
// for the running month starts it below pace ("At 23 so far, 45 starts below
// pace."), by the one rule every goal is called below pace with. Components
// import Reporting's values from here, never from the domain (the components
// boundary in eslint.config.js).
export { goalPace } from '../domain/goal-pace'
