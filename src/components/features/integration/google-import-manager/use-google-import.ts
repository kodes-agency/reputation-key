import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createGoogleImportContentLifecycle,
  type ImportCandidateDto,
} from '#/contexts/integration/application/public-api'
import {
  googleImportReviewDraftSchema,
  type GoogleImportReviewDraftInput,
} from '#/contexts/integration/application/dto/google-import-v2.dto'
import { integrationKeys } from '#/shared/queries/query-keys'
import type {
  GoogleImportContentOptions,
  GoogleImportDiscoveryController,
  GoogleImportDiscoveryOptions,
  GoogleImportReviewFormApi,
  GoogleImportReviewOptions,
  GoogleImportStep,
} from './google-import-manager-contract'
import {
  googleImportAccountsQuery,
  googleImportCandidatesQuery,
  googleImportContentExpiry,
  googleImportLeaseQuery,
  scheduleGoogleImportExpiries,
} from './google-import-queries'
import { leaseRenewalFailureIsFinal } from './google-import-error-messages'
import { createImportReviewDraft } from './google-import-review-model'
import {
  activeGoogleImportConnectionId,
  createGoogleImportDiscoveryState,
  filterLoadedCandidates,
  reduceGoogleImportDiscoveryState,
  selectAllEligibleFromQuery,
  toggleLoadedCandidates,
  toggleSelectedCandidate,
} from './google-import-selection'
const EMPTY_REVIEW: GoogleImportReviewDraftInput = {
  items: [],
  profileAcknowledged: false,
}

export function useGoogleImportReviewForm({
  initialDraft,
  onSubmit,
}: GoogleImportReviewOptions): GoogleImportReviewFormApi {
  return useForm({
    defaultValues: initialDraft ?? EMPTY_REVIEW,
    validators: { onSubmit: googleImportReviewDraftSchema },
    onSubmit: ({ value }) => onSubmit(value),
  })
}

function useGoogleImportContent({
  organizationId,
  connectionId,
  accountRef,
  enabled,
  importFns,
  clearProviderState,
}: GoogleImportContentOptions) {
  const queryClient = useQueryClient()
  const organizationIdRef = useRef(organizationId)
  const [epoch, setEpoch] = useState(0)
  const [lifecycle] = useState(() =>
    createGoogleImportContentLifecycle({
      removeQueries: () =>
        queryClient.removeQueries({ queryKey: integrationKeys.googleImportContent() }),
      clearContent: () => {
        clearProviderState()
        setEpoch((value) => value + 1)
      },
    }),
  )
  const accountsQuery = useInfiniteQuery(
    googleImportAccountsQuery({
      organizationId,
      connectionId,
      enabled,
      epoch,
      guard: lifecycle.guard,
      listAccounts: importFns.listImportAccounts,
    }),
  )
  const candidatesQuery = useInfiniteQuery(
    googleImportCandidatesQuery({
      organizationId,
      connectionId,
      accountRef,
      enabled,
      epoch,
      guard: lifecycle.guard,
      listCandidates: importFns.listImportCandidates,
    }),
  )
  const accountPages = accountsQuery.data?.pages ?? []
  const candidatePages = candidatesQuery.data?.pages ?? []
  const accounts = accountPages.flatMap((page) => page.items)
  const candidates = candidatePages.flatMap((page) => page.items)
  const contentExpiresAt = googleImportContentExpiry([...accountPages, ...candidatePages])
  const authorizationLease = (candidatePages.at(-1) ?? accountPages.at(-1))
    ?.authorizationLease
  const leaseQuery = useQuery(
    googleImportLeaseQuery({
      organizationId,
      connectionId,
      leaseRef: authorizationLease?.leaseRef ?? null,
      enabled,
      hasProviderContent: accounts.length > 0 || candidates.length > 0,
      epoch,
      guard: lifecycle.guard,
      renewLease: importFns.renewImportAuthorizationLease,
    }),
  )
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
    return () => lifecycle.leave()
  }, [lifecycle])
  useEffect(() => {
    if (!enabled) return
    return scheduleGoogleImportExpiries(lifecycle, contentExpiresAt, leaseExpiresAt)
  }, [contentExpiresAt, enabled, leaseExpiresAt, lifecycle])
  useEffect(() => {
    if (organizationIdRef.current === organizationId) return
    organizationIdRef.current = organizationId
    lifecycle.clear('tenant_changed')
  }, [lifecycle, organizationId])
  // Only a refusal the server decided clears content at once. A renewal that
  // failed in transit may still leave a valid lease; the scheduled lease expiry
  // clears it if no later renewal succeeds.
  useEffect(() => {
    if (leaseQuery.error && leaseRenewalFailureIsFinal(leaseQuery.error)) {
      lifecycle.clear('lease_expired')
    }
  }, [leaseQuery.error, lifecycle])

  return { accounts, candidates, accountsQuery, candidatesQuery, lifecycle }
}

export function useGoogleImport({
  organizationId,
  connections,
  initialConnectionId,
  initialProgress,
  initialRequestId,
  importFns,
  onClearStartError,
}: GoogleImportDiscoveryOptions): GoogleImportDiscoveryController {
  const initialConnection = activeGoogleImportConnectionId(
    connections,
    initialConnectionId,
  )
  const [state, dispatch] = useReducer(
    reduceGoogleImportDiscoveryState,
    createGoogleImportDiscoveryState(
      initialConnection,
      Boolean(initialProgress),
      initialRequestId !== undefined,
    ),
  )
  const clearProviderState = useCallback(() => {
    dispatch({ type: 'clear' })
    onClearStartError()
  }, [onClearStartError])
  const content = useGoogleImportContent({
    organizationId,
    connectionId: state.connectionId,
    accountRef: state.accountRef,
    enabled: state.contentActive,
    importFns,
    clearProviderState,
  })
  const visibleCandidates = useMemo(
    () => filterLoadedCandidates(content.candidates, state.search),
    [content.candidates, state.search],
  )

  useEffect(() => {
    if (
      state.connectionId === null ||
      connections.some(
        (connection) =>
          connection.id === state.connectionId && connection.status === 'active',
      )
    )
      return
    content.lifecycle.clear('authorization_revoked')
    dispatch({
      type: 'set_connection',
      connectionId:
        connections.find((connection) => connection.status === 'active')?.id ?? null,
      active: false,
    })
  }, [connections, content.lifecycle, state.connectionId])

  const changeConnection = async (connectionId: string) => {
    if (
      connectionId === state.connectionId ||
      !connections.some(
        (connection) => connection.id === connectionId && connection.status === 'active',
      )
    )
      return
    content.lifecycle.clear('connection_changed')
    dispatch({ type: 'set_connection', connectionId, active: true })
  }
  const toggleCandidate = (candidate: ImportCandidateDto, checked: boolean) => {
    const result = toggleSelectedCandidate(state.selectedIds, candidate, checked)
    if (result.changed) {
      dispatch({ type: 'set_selection', selectedIds: new Set(result.selectedIds) })
    }
  }
  const toggleLoaded = (checked: boolean) => {
    const result = toggleLoadedCandidates(state.selectedIds, visibleCandidates, checked)
    if (result.changed) {
      dispatch({ type: 'set_selection', selectedIds: new Set(result.selectedIds) })
    }
  }
  const selectAllEligible = async () => {
    if (state.selectAllPending) return
    dispatch({ type: 'select_all_pending', pending: true })
    dispatch({ type: 'select_all_error', error: null })
    try {
      const selectedIds = await selectAllEligibleFromQuery(
        content.candidates,
        content.candidatesQuery,
      )
      dispatch({ type: 'set_selection', selectedIds: new Set(selectedIds) })
    } catch {
      dispatch({
        type: 'select_all_error',
        error:
          'Not every Google location could be loaded. Your current selection was kept.',
      })
    } finally {
      dispatch({ type: 'select_all_pending', pending: false })
    }
  }
  const review = () => {
    const candidates = content.candidates.filter((candidate) =>
      state.selectedIds.has(candidate.candidateId),
    )
    dispatch({
      type: 'review',
      candidates,
      draft: createImportReviewDraft(candidates),
    })
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  return {
    accounts: content.accounts,
    accountsQuery: content.accountsQuery,
    candidatesQuery: content.candidatesQuery,
    lifecycle: content.lifecycle,
    ...state,
    setStep: (step: GoogleImportStep) => dispatch({ type: 'set_step', step }),
    setSearch: (search) => dispatch({ type: 'set_search', search }),
    visibleCandidates,
    changeConnection,
    resumeDiscovery: () => dispatch({ type: 'resume' }),
    selectAccount: (accountRef) => dispatch({ type: 'select_account', accountRef }),
    toggleCandidate,
    toggleLoaded,
    selectAllEligible,
    review,
  }
}
