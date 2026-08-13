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
  listAccounts,
  listCandidates,
  renewAuthorizationLease,
  onClearStartError,
}: Props) {
  const [step, setStep] = useState<'discover' | 'review' | 'progress'>(
    initialProgress ? 'progress' : 'discover',
  )
  const [connectionId, setConnectionId] = useState<string | null>(
    initialConnectionId ?? connections[0]?.id ?? null,
  )
  const [accountRef, setAccountRef] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [reviewDraft, setReviewDraft] = useState<ImportReviewDraft | null>(null)
  const [reviewCandidates, setReviewCandidates] = useState<readonly ImportCandidateDto[]>(
    [],
  )
  const clearProviderState = useCallback(() => {
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
      !connectionId ||
      connections.some((connection) => connection.id === connectionId)
    ) {
      return
    }
    setConnectionId(connections[0]?.id ?? null)
    void content.lifecycle.clear('authorization_revoked')
  }, [connectionId, connections, content.lifecycle])

  const changeConnection = async (nextConnectionId: string) => {
    if (nextConnectionId === connectionId) return
    await content.lifecycle.clear('connection_changed')
    setConnectionId(nextConnectionId)
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
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return {
    ...content,
    step,
    setStep,
    connectionId,
    accountRef,
    selectedIds,
    search,
    setSearch,
    visibleCandidates,
    reviewDraft,
    setReviewDraft,
    reviewCandidates,
    changeConnection,
    selectAccount,
    toggleCandidate,
    toggleLoaded,
    review,
  }
}

export type GoogleImportDiscoveryController = ReturnType<
  typeof useGoogleImportDiscoveryController
>
