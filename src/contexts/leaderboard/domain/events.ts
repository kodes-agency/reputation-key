// Leaderboard context — domain events
//
// No events are currently emitted by this context (LB-03).
// The `leaderboard.snapshot.refreshed` event was pruned because it had zero
// subscribers and was admitted dead in CONTEXT.md. Snapshot refreshes are
// observable via the `leaderboardSnapshots.lastUpdatedAt` column instead.
