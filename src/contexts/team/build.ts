// Team is retained only as a data/reconciliation quarantine package.
//
// The standard context build boundary remains so the 17-package architecture
// inventory stays explicit, but it deliberately constructs no repository,
// command, job, consumer, or network surface. Production composition must not
// call this function. Historical repositories are reached only by the
// catalogued operator/release reconciliation commands.

export const buildTeamContext = () =>
  ({
    publicApi: {},
    internal: {
      repos: {},
      useCases: {},
    },
  }) as const
