import type * as Runtime from '#/shared/ai-runtime-capability-contract'

/** Historical v1 contract tests pin execution selection independently of today's release. */
export function historicalReplyRuntime(actual: typeof Runtime): typeof Runtime {
  const historical = actual.AI_RUNTIME_CAPABILITY_CATALOGUE.find(
    (entry) => entry.runtimeProfileVersion === 'reply-drafting-runtime-v1',
  )!
  return {
    ...actual,
    AI_RUNTIME_CAPABILITIES_V1: actual.AI_RUNTIME_CAPABILITIES_V1.map((entry) =>
      entry.capability === 'reply_drafting' ? historical : entry,
    ),
    getAiRuntimeCapability: (capability) =>
      capability === 'reply_drafting'
        ? historical
        : actual.getAiRuntimeCapability(capability),
  }
}
