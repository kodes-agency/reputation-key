// Leaderboard/Recognition is retained only as a data/export/restore
// contraction package.
//
// The standard context boundary remains visible to architecture inventory, but
// it deliberately constructs no repository, use case, event consumer, job, or
// schedule. Historical mechanics remain source-only until their data has an
// accepted export/restore disposition.

export const buildLeaderboardContext = () =>
  ({
    publicApi: {},
    internal: {
      repos: {},
      useCases: {},
    },
  }) as const

export type LeaderboardContextApi = ReturnType<typeof buildLeaderboardContext>
