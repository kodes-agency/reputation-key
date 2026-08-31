// Badge is retained only as a data/export/restore contraction package.
//
// Keep the standard context boundary visible to architecture inventory, but do
// not construct a repository, producer, use case, consumer, or scheduled job.
// Historical source can be called explicitly by isolated restore tooling; no
// application composition path may acquire it through this build function.

export const buildBadgeContext = () =>
  ({
    publicApi: {},
    internal: {
      repos: {},
      useCases: {},
    },
  }) as const

export type BadgeContextApi = ReturnType<typeof buildBadgeContext>
