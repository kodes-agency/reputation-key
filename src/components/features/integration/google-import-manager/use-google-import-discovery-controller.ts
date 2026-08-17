import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { ImportCandidateDto } from '#/contexts/integration/application/public-api'
import type { GoogleImportManagerProps } from './google-import-manager-contract'
import type { ImportReviewDraft } from './google-import-review-model'
import { createImportReviewDraft } from './google-import-review-model'
import {
  filterLoadedCandidates,
  toggleLoadedCandidates,
  toggleSelectedCandidate,
} from './google-import-selection'
import { useGoogleImportContent } from './use-google-import-content'

type Props = Pick<
  GoogleImportManagerProps,
  | 'organizationId'
  | 'connections'
  | 'initialConnectionId'
  | 'initialProgress'
  | 'initialRequestId'
  | 'listAccounts'
  | 'listCandidates'
  | 'renewAuthorizationLease'
> &
  Readonly<{ onClearStartError: () => void }>

export function useGoogleImportDiscoveryController({
  organizationId,
  connections,
  initialConnectionId,
  initialProgress,
  initialRequestId,
  listAccounts,
  listCandidates,
  renewAuthorizationLease,
  onClearStartError,
}: Props) {
  const initialActiveConnectionId =
    connections.find(
      (connection) =>
        connection.id === initialConnectionId && connection.status === 'active',
    )?.id ??
    connections.find((connection) => connection.status === 'active')?.id ??
    null
  const [step, setStep] = useState<'discover' | 'review' | 'progress'>(
    initialProgress ? 'progress' : 'discover',
  )
  const [connectionId, setConnectionId] = useState<string | null>(
    initialActiveConnectionId,
  )
  const [contentActive, setContentActive] = useState(
    initialActiveConnectionId !== null && initialRequestId === undefined,
  )
  const [accountRef, setAccountRef] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [reviewDraft, setReviewDraft] = useState<ImportReviewDraft | null>(null)
  const [reviewCandidates, setReviewCandidates] = useState<readonly ImportCandidateDto[]>(
    [],
  )
  const clearProviderState = useCallback(() => {
    setContentActive(false)
    setAccountRef(null)
    setSelectedIds(new Set())
    setSearch('')
    setReviewDraft(null)
    setReviewCandidates([])
    onClearStartError()
    setStep('discover')
  }, [onClearStartError])
  const content = useGoogleImportContent({
    organizationId,
    connectionId,
    accountRef,
    step,
    enabled: contentActive,
    listAccounts,
    listCandidates,
    renewAuthorizationLease,
    clearProviderState,
  })
  const visibleCandidates = useMemo(
    () => filterLoadedCandidates(content.candidates, search),
    [content.candidates, search],
  )

  useEffect(() => {
    if (
      connectionId === null ||
      connections.some(
        (connection) => connection.id === connectionId && connection.status === 'active',
      )
    ) {
      return
    }
    void (async () => {
      await content.lifecycle.clear('authorization_revoked')
      setConnectionId(
        connections.find((connection) => connection.status === 'active')?.id ?? null,
      )
    })()
  }, [connectionId, connections, content.lifecycle])

  const changeConnection = async (nextConnectionId: string) => {
    if (
      nextConnectionId === connectionId ||
      !connections.some(
        (connection) =>
          connection.id === nextConnectionId && connection.status === 'active',
      )
    ) {
      return
    }
    await content.lifecycle.clear('connection_changed')
    setConnectionId(nextConnectionId)
    setContentActive(true)
  }
  const resumeDiscovery = () => {
    if (connectionId !== null) setContentActive(true)
  }
  const selectAccount = (nextAccountRef: string) => {
    setAccountRef(nextAccountRef)
    setSelectedIds(new Set())
    setSearch('')
  }
  const toggleCandidate = (candidate: ImportCandidateDto, checked: boolean) => {
    const result = toggleSelectedCandidate(selectedIds, candidate, checked)
    if (result.limitReached) toast.error('You can import up to 100 properties at once.')
    if (result.changed) setSelectedIds(new Set(result.selectedIds))
  }
  const toggleLoaded = (checked: boolean) => {
    const result = toggleLoadedCandidates(selectedIds, visibleCandidates, checked)
    if (result.limitReached) toast.error('Selection stopped at the 100-property limit.')
    if (result.changed) setSelectedIds(new Set(result.selectedIds))
  }
  const review = () => {
    const selected = content.candidates.filter((candidate) =>
      selectedIds.has(candidate.candidateId),
    )
    const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    setReviewCandidates(selected)
    setReviewDraft(createImportReviewDraft(selected, browserTimezone))
    setStep('review')
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  return {
    ...content,
    step,
    setStep,
    connectionId,
    contentActive,
    accountRef,
    selectedIds,
    search,
    setSearch,
    visibleCandidates,
    reviewDraft,
    setReviewDraft,
    reviewCandidates,
    changeConnection,
    resumeDiscovery,
    selectAccount,
    toggleCandidate,
    toggleLoaded,
    review,
  }
}

export type GoogleImportDiscoveryController = ReturnType<
  typeof useGoogleImportDiscoveryController
>
