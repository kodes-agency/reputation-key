import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { integrationKeys } from '#/shared/queries/query-keys'
import type {
  GoogleImportManagerProps,
  GoogleImportStep,
} from './google-import-manager-contract'
import {
  StaleGoogleImportViewError,
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
    connectionId: string | null
    accountRef: string | null
    step: GoogleImportStep
    clearProviderState: () => void
  }>

function isContentExpired(expiresAt: string | null): boolean {
  return expiresAt !== null && Date.parse(expiresAt) <= Date.now()
}

export function useGoogleImportContent({
  organizationId,
  connectionId,
  accountRef,
  step,
  listAccounts,
  listCandidates,
  renewAuthorizationLease,
  clearProviderState,
}: Props) {
  const queryClient = useQueryClient()
  const mounted = useRef(true)
  const [epoch, setEpoch] = useState(0)
  const lifecycle = useMemo(
    () =>
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
          if (!mounted.current) return
          clearProviderState()
          setEpoch((value) => value + 1)
        },
      }),
    [clearProviderState, queryClient],
  )
  const accountsQuery = useGoogleImportAccounts({
    organizationId,
    connectionId,
    listAccounts,
    epoch,
    guard: lifecycle.guard,
  })
  const candidatesQuery = useGoogleImportCandidates({
    organizationId,
    connectionId,
    accountRef,
    listCandidates,
    epoch,
    guard: lifecycle.guard,
  })
  const accounts = accountsQuery.data?.pages.flatMap((page) => page.items) ?? []
  const candidates = candidatesQuery.data?.pages.flatMap((page) => page.items) ?? []
  const latestPage =
    candidatesQuery.data?.pages.at(-1) ?? accountsQuery.data?.pages.at(-1) ?? null
  const authorizationLease = latestPage?.authorizationLease ?? null
  const leaseQuery = useGoogleImportContentLease({
    organizationId,
    connectionId,
    leaseRef: authorizationLease?.leaseRef ?? null,
    renewLease: renewAuthorizationLease,
    hasProviderContent: accounts.length > 0 || candidates.length > 0,
    epoch,
    guard: lifecycle.guard,
  })

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      void lifecycle.clear('route_left')
    }
  }, [lifecycle])
  useEffect(() => {
    if (step !== 'discover' && step !== 'review') return
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') void lifecycle.clear('page_hidden')
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [lifecycle, step])
  useEffect(() => {
    if (isContentExpired(latestPage?.contentExpiresAt ?? null)) {
      void lifecycle.clear('content_expired')
    }
  }, [latestPage?.contentExpiresAt, lifecycle])
  useEffect(() => {
    if (!leaseQuery.error || leaseQuery.error instanceof StaleGoogleImportViewError)
      return
    void lifecycle.clear('lease_expired')
  }, [leaseQuery.error, lifecycle])

  return { accounts, candidates, accountsQuery, candidatesQuery, lifecycle }
}
