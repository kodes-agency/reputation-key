// Platform operator console read (ADR 0063): the Organization list.
//
// No tenant context: the operator holds no role in the Organizations the
// console lists. The read accepts any session age; the operator is re-checked
// on every call (platform-console-operator.server.ts) before the console
// capability is reached.
//
// This module is all the operator route's first-paint code imports: its loader
// primes the list. The four changes live in platform-console-changes.ts so
// their stubs ship with the lazy route chunk, not with every page.

import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { getContainer } from '#/composition'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import type { PlatformOrganizationView } from '../application/dto/platform-console.dto'
import { asOperator } from './platform-console-operator.server'

/** The list names the invitees of ownerless Organizations: no cache keeps it. */
function keepListPrivate(): void {
  setResponseHeader('Cache-Control', 'private, no-store, max-age=0')
  setResponseHeader('Vary', 'Cookie')
}

export const listPlatformOrganizationsHandler = createServerOnlyFn(
  (): Promise<ReadonlyArray<PlatformOrganizationView>> => {
    keepListPrivate()
    return asOperator(false, () => getContainer().identityPlatform.listOrganizations())
  },
)

export const listPlatformOrganizationsFn = createServerFn({ method: 'GET' }).handler(
  tracedHandler(
    listPlatformOrganizationsHandler,
    'GET',
    'identity.platform.listOrganizations',
  ),
)
