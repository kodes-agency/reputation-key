import type { AiProviderSelectionConfig } from './provider-selection'

// The operator's choice of provider per capability (contract section 7.3, decision 7),
// locked to OpenAI since the switch-on of review analysis v3 (2026-10-30).
//
// Review analysis v3 is attested for two providers (OpenAI and Anthropic, both named by the
// deployment profile `private-beta-global-v2`), so it needs the operator to name one, and
// the name is this constant. It is a constant on purpose, and not an environment variable:
// nothing a deployment's settings can change makes a real guest review reach Anthropic.
// The merchant notice and the Privacy Notice both say Anthropic receives no real Google
// review before the Privacy Notice period for the new processor has run, counted from the
// email to Participants; the first activation runs on OpenAI alone.
//
// Anthropic is configured and not selectable. Its adapter is attested and tested, but the
// egress runtime registers none (`ai-egress-runtime.ts`), the deployment holds no Anthropic
// key, no execution-control head exists for a concrete provider yet (the scopes
// `provider:openai` and `provider:anthropic` are admitted by migration 0078 and read by
// nothing), and this choice names OpenAI. Moving review analysis to Anthropic is one
// reviewed change after the Anthropic date, not a switch: register the adapter with its
// key, seed and wire the provider control head (docs/operations/runbooks.md section 32),
// change this constant, and take a new review analysis epoch, so one evidence window
// never mixes two models' judgements. Reply drafting and the canary are attested for
// OpenAI alone and ignore the choice.
export const OPERATOR_PROVIDER_SELECTION: AiProviderSelectionConfig = Object.freeze({
  review_analysis: 'openai',
  reply_drafting: 'openai',
})
