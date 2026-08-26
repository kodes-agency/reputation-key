import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { integrationKeys } from '#/shared/queries/query-keys'
import type {
  GoogleImportManagerProps,
  GoogleImportStep,
} from './google-import-manager-contract'
import {
  StaleGoogleImportViewError,
  contentExpiryDelayMs,
  createGoogleImportContentLifecycle,
} from './google-import-content-lifecycle'
import {
  useGoogleImportAccounts,
  useGoogleImportCandidates,
  useGoogleImportContentLease,
} from './use-google-import-queries'

type Props = Pick<
  GoogleImportManagerProps,
  'organizationId' | 'listAccounts' | 'listCandidates' | 'renewAuthorizationLease'
> &
  Readonly<{
    enabled: boolean
    connectionId: string | null
    accountRef: string | null
    step: GoogleImportStep
    clearProviderState: () => void
  }>

export function useGoogleImportContent({
  organizationId,
  connectionId,
  accountRef,
  step,
  enabled,
  listAccounts,
  listCandidates,
  renewAuthorizationLease,
  clearProviderState,
}: Props) {
  const queryClient = useQueryClient()
  const organizationIdRef = useRef(organizationId)
  const [epoch, setEpoch] = useState(0)
  const [lifecycle] = useState(() =>
    createGoogleImportContentLifecycle({
      cancelQueries: async () => {
        await queryClient.cancelQueries({
          queryKey: integrationKeys.googleImportContent(),
        })
      },
      removeQueries: () => {
        queryClient.removeQueries({
          queryKey: integrationKeys.googleImportContent(),
        })
      },
      clearContent: () => {
        clearProviderState()
        setEpoch((value) => value + 1)
      },
    }),
  )
  const accountsQuery = useGoogleImportAccounts({
    organizationId,
    enabled,
    connectionId,
    listAccounts,
    epoch,
    guard: lifecycle.guard,
  })
  const candidatesQuery = useGoogleImportCandidates({
    organizationId,
    connectionId,
    enabled,
    accountRef,
    listCandidates,
    epoch,
    guard: lifecycle.guard,
  })
  const accountPages = accountsQuery.data?.pages ?? []
  const candidatePages = candidatesQuery.data?.pages ?? []
  const accounts = accountPages.flatMap((page) => page.items)
  const candidates = candidatePages.flatMap((page) => page.items)
  let contentExpiresAt: string | null = null
  let contentExpiryMs = Number.POSITIVE_INFINITY
  let malformedDeadline = false
  const considerDeadline = (value: string) => {
    const valueMs = Date.parse(value)
    if (!Number.isFinite(valueMs)) {
      contentExpiresAt = value
      malformedDeadline = true
    } else if (valueMs < contentExpiryMs) {
      contentExpiresAt = value
      contentExpiryMs = valueMs
    }
  }
  for (const page of accountPages) {
    considerDeadline(page.contentExpiresAt)
    if (malformedDeadline) break
  }
  if (!malformedDeadline) {
    for (const page of candidatePages) {
      considerDeadline(page.contentExpiresAt)
      if (malformedDeadline) break
    }
  }
  const latestPage = candidatePages.at(-1) ?? accountPages.at(-1) ?? null
  const authorizationLease = latestPage?.authorizationLease ?? null
  const leaseQuery = useGoogleImportContentLease({
    organizationId,
    enabled,
    connectionId,
    leaseRef: authorizationLease?.leaseRef ?? null,
    renewLease: renewAuthorizationLease,
    hasProviderContent: accounts.length > 0 || candidates.length > 0,
    epoch,
    guard: lifecycle.guard,
  })
  const leaseExpiresAt =
    leaseQuery.data?.expiresAt ?? authorizationLease?.expiresAt ?? null

  useEffect(() => {
    lifecycle.setClearContent(() => {
      clearProviderState()
      setEpoch((value) => value + 1)
    })
  }, [clearProviderState, lifecycle])
  useEffect(() => {
    lifecycle.activate()
    return () => {
      lifecycle.deactivate()
      void lifecycle.clear('route_left')
    }
  }, [lifecycle])
  useEffect(() => {
    if (!enabled || (step !== 'discover' && step !== 'review')) return
    const clearHiddenContent = () => {
      if (document.visibilityState === 'hidden') void lifecycle.clear('page_hidden')
    }
    const clearExitedContent = () => void lifecycle.clear('page_hidden')
    document.addEventListener('visibilitychange', clearHiddenContent)
    document.addEventListener('freeze', clearExitedContent)
    window.addEventListener('pagehide', clearExitedContent)
    return () => {
      document.removeEventListener('visibilitychange', clearHiddenContent)
      document.removeEventListener('freeze', clearExitedContent)
      window.removeEventListener('pagehide', clearExitedContent)
    }
  }, [enabled, lifecycle, step])
  useEffect(() => {
    if (!enabled || contentExpiresAt === null) return
    const timeout = window.setTimeout(
      () => void lifecycle.clear('content_expired'),
      contentExpiryDelayMs(contentExpiresAt, Date.now()),
    )
    return () => window.clearTimeout(timeout)
  }, [contentExpiresAt, enabled, lifecycle])
  useEffect(() => {
    if (!enabled || leaseExpiresAt === null) return
    const timeout = window.setTimeout(
      () => void lifecycle.clear('lease_expired'),
      contentExpiryDelayMs(leaseExpiresAt, Date.now()),
    )
    return () => window.clearTimeout(timeout)
  }, [enabled, leaseExpiresAt, lifecycle])
  useEffect(() => {
    if (!leaseQuery.error || leaseQuery.error instanceof StaleGoogleImportViewError)
      return
    void lifecycle.clear('lease_expired')
  }, [leaseQuery.error, lifecycle])
  useEffect(() => {
    if (organizationIdRef.current === organizationId) return
    organizationIdRef.current = organizationId
    void lifecycle.clear('tenant_changed')
  }, [lifecycle, organizationId])

  return { accounts, candidates, accountsQuery, candidatesQuery, lifecycle }
}
