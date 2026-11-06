import { and, eq } from 'drizzle-orm'
import type { Tx } from '#/shared/outbox/commit'
import { googleConnections } from './schema/google-connection.schema'

/** Lock before the Property row so publication and disconnect share lock order. */
export async function lockGoogleConnectionBindingAuthority(
  tx: Tx,
  scope: Readonly<{
    organizationId: string
    connectionId: string
    expectedLifecycleVersion?: number
    expectedAccessVersion?: number
  }>,
): Promise<boolean> {
  const [connection] = await tx
    .select({ id: googleConnections.id })
    .from(googleConnections)
    .where(
      and(
        eq(googleConnections.organizationId, scope.organizationId),
        eq(googleConnections.id, scope.connectionId),
        eq(googleConnections.status, 'active'),
        eq(googleConnections.credentialUseState, 'active'),
        scope.expectedLifecycleVersion === undefined
          ? undefined
          : eq(googleConnections.lifecycleVersion, scope.expectedLifecycleVersion),
        scope.expectedAccessVersion === undefined
          ? undefined
          : eq(googleConnections.accessVersion, scope.expectedAccessVersion),
      ),
    )
    // KEY SHARE only protects the FK; SHARE also fences lifecycle updates.
    .for('share')
    .limit(1)
  return connection !== undefined
}
