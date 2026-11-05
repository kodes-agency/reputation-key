import { getContainer } from '#/composition'
import { getLogger } from '#/shared/observability/logger'
import { containerLifecycleState } from './container-lifecycle'

/**
 * Whether this process holds a built container. The first call builds it, which
 * reads every key group construction needs, so a deployment missing one stays
 * unready instead of failing its first request. A failed build is remembered;
 * a draining process is never ready and never builds.
 */
export function isContainerReady(): boolean {
  const state = containerLifecycleState()
  if (state === 'draining' || state === 'failed') return false
  try {
    getContainer()
  } catch (err) {
    getLogger().warn({ err }, '[health] container construction failed')
    return false
  }
  return containerLifecycleState() === 'ready'
}
