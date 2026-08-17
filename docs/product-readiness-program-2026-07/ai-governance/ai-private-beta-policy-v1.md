# AI private-beta policy v1

Generated from `src/contexts/ai/domain/catalogues/ai-private-beta-policy-v1.json`. Digest: `7031c514c9296bf1895ae185e2a0df485df48807bb409acc275386ac199e2569`.

## Capabilities

| id              | platformCapability | permission               | actorKind | routeId          | runtimeProfileVersion      | requires        |
| --------------- | ------------------ | ------------------------ | --------- | ---------------- | -------------------------- | --------------- |
| property_trends | ai.detect_trends   | ai.trends.read           | worker    | property-trend   | property-trends-runtime-v1 | review_analysis |
| reply_drafting  | ai.generate_reply  | ai.reply.generate        | manager   | reply-suggestion | reply-drafting-runtime-v1  | —               |
| review_analysis | ai.analyze         | background_system_policy | worker    | review-analysis  | review-analysis-runtime-v1 | —               |

## Routes

| id               | sourceClassId             | outputClassId                | retentionPolicyId           |
| ---------------- | ------------------------- | ---------------------------- | --------------------------- |
| property-trend   | aggregate-only            | trend-selection              | trend-report-24-months      |
| reply-suggestion | identity-minimized-review | ephemeral-template-selection | browser-ephemeral           |
| review-analysis  | identity-minimized-review | review-derivative            | review-derivative-24-months |

## Roles

| id               | permissions                                     |
| ---------------- | ----------------------------------------------- |
| manager          | ai.reply.generate, ai.trends.read, reply.manage |
| settings-manager | ai.manage, property.manage                      |
| worker           | background_system_policy                        |

## Release gates

| id                         | stage      | owner | contentClass |
| -------------------------- | ---------- | ----- | ------------ |
| ai-boundary-tests          | candidate  | PR3   | content_free |
| ai-canary-terminal         | activation | PR10  | content_free |
| ai-egress-gateway-build    | candidate  | PR5   | content_free |
| ai-governance-drift        | candidate  | PR3   | content_free |
| ai-openai-provider-profile | candidate  | PR5   | content_free |
| ai-provider-quality        | candidate  | PR6   | content_free |
| ai-provider-stub-isolation | candidate  | PR5   | content_free |
| ai-runtime-egress-probe    | activation | PR10  | content_free |
| ai-runtime-isolation       | activation | PR11  | content_free |
