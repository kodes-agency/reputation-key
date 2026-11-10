// The guard of the development scripts that write to whatever DATABASE_URL
// names lives in src/shared/ops/local-database.ts, where the rights command
// shares it.
export {
  assertLocalOnlyDatabase,
  assertLocalOnlyRedis,
  type LocalDatabaseTarget,
} from '../../src/shared/ops/local-database'
