import { CONCURRENT_INDEX_REGISTRY } from './concurrent-index-registry'
import {
  buildConcurrentIndex,
  type ConcurrentIndexResult,
  type SqlClient,
} from './concurrent-index-migration'

/** Retain existing index provisioning until its journal-adoption release. */
export async function buildRegisteredConcurrentIndexes(
  client: SqlClient,
): Promise<readonly ConcurrentIndexResult[]> {
  const results: ConcurrentIndexResult[] = []
  for (const spec of CONCURRENT_INDEX_REGISTRY) {
    results.push(await buildConcurrentIndex(client, spec))
  }
  return results
}
