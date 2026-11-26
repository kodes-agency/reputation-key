// The process-wide handles integration suites arrange against. Fixture files
// inside a context take them from here, so context code reads no ambient state.

import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'

export const testDb = () => getDb()
export const testDatabaseUrl = () => getEnv().DATABASE_URL
