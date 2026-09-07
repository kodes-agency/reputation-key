import type {
  GoogleConnectionDto,
  ImportCandidateDto,
} from '#/contexts/integration/application/public-api'
import type { GoogleImportStep } from './google-import-manager-contract'
import type { ImportReviewDraft } from './google-import-review-model'

export function activeGoogleImportConnectionId(
  connections: readonly GoogleConnectionDto[],
  preferredId?: string,
): string | null {
  return (
    connections.find(
      (connection) => connection.id === preferredId && connection.status === 'active',
    )?.id ??
    connections.find((connection) => connection.status === 'active')?.id ??
    null
  )
}

export type GoogleImportDiscoveryState = Readonly<{
  step: GoogleImportStep
  connectionId: string | null
  contentActive: boolean
  accountRef: string | null
  selectedIds: ReadonlySet<string>
  search: string
  selectAllPending: boolean
  selectAllError: string | null
  reviewDraft: ImportReviewDraft | null
  reviewCandidates: readonly ImportCandidateDto[]
}>

export type GoogleImportDiscoveryAction =
  | Readonly<{ type: 'clear' }>
  | Readonly<{ type: 'set_step'; step: GoogleImportStep }>
  | Readonly<{ type: 'set_connection'; connectionId: string | null; active: boolean }>
  | Readonly<{ type: 'resume' }>
  | Readonly<{ type: 'select_account'; accountRef: string }>
  | Readonly<{ type: 'set_search'; search: string }>
  | Readonly<{ type: 'set_selection'; selectedIds: ReadonlySet<string> }>
  | Readonly<{ type: 'select_all_pending'; pending: boolean }>
  | Readonly<{ type: 'select_all_error'; error: string | null }>
  | Readonly<{
      type: 'review'
      draft: ImportReviewDraft
      candidates: readonly ImportCandidateDto[]
    }>

export function createGoogleImportDiscoveryState(
  connectionId: string | null,
  hasInitialProgress: boolean,
  recoveringRequest: boolean,
): GoogleImportDiscoveryState {
  return {
    step: hasInitialProgress ? 'progress' : 'discover',
    connectionId,
    contentActive: connectionId !== null && !recoveringRequest,
    accountRef: null,
    selectedIds: new Set(),
    search: '',
    selectAllPending: false,
    selectAllError: null,
    reviewDraft: null,
    reviewCandidates: [],
  }
}

export function reduceGoogleImportDiscoveryState(
  state: GoogleImportDiscoveryState,
  action: GoogleImportDiscoveryAction,
): GoogleImportDiscoveryState {
  switch (action.type) {
    case 'clear':
      return {
        ...createGoogleImportDiscoveryState(state.connectionId, false, true),
        connectionId: state.connectionId,
      }
    case 'set_step':
      return { ...state, step: action.step }
    case 'set_connection':
      return {
        ...state,
        connectionId: action.connectionId,
        contentActive: action.active,
      }
    case 'resume':
      return state.connectionId === null ? state : { ...state, contentActive: true }
    case 'select_account':
      return {
        ...state,
        accountRef: action.accountRef,
        selectedIds: new Set(),
        search: '',
        selectAllError: null,
      }
    case 'set_search':
      return { ...state, search: action.search }
    case 'set_selection':
      return { ...state, selectedIds: action.selectedIds }
    case 'select_all_pending':
      return { ...state, selectAllPending: action.pending }
    case 'select_all_error':
      return { ...state, selectAllError: action.error }
    case 'review':
      return {
        ...state,
        step: 'review',
        reviewDraft: action.draft,
        reviewCandidates: action.candidates,
      }
  }
}

type SelectionResult = Readonly<{
  selectedIds: readonly string[]
  changed: boolean
}>

export function isSelectableImportCandidate(candidate: ImportCandidateDto): boolean {
  return (
    candidate.candidateRef !== null &&
    (candidate.eligibility.kind === 'create' || candidate.eligibility.kind === 'relink')
  )
}

type CandidatePageSnapshot = Readonly<{
  candidates: readonly ImportCandidateDto[]
  hasNextPage: boolean
}>

/**
 * Fetches through the provider cursor before changing selection. Each fetched
 * snapshot contains all pages loaded so far, matching TanStack Query's
 * infinite-query result. A failed fetch rejects without publishing a partial
 * "select all" result.
 */
export async function selectAllEligibleCandidates(
  initial: CandidatePageSnapshot,
  fetchNextPage: () => Promise<CandidatePageSnapshot>,
): Promise<readonly string[]> {
  let snapshot = initial
  while (snapshot.hasNextPage) snapshot = await fetchNextPage()
  return snapshot.candidates
    .filter(isSelectableImportCandidate)
    .map((candidate) => candidate.candidateId)
}

type CandidateQuery = Readonly<{
  hasNextPage: boolean
  fetchNextPage: () => Promise<
    Readonly<{
      error: unknown
      data?: Readonly<{
        pages: readonly Readonly<{ items: readonly ImportCandidateDto[] }>[]
      }>
      hasNextPage: boolean
    }>
  >
}>

export function selectAllEligibleFromQuery(
  candidates: readonly ImportCandidateDto[],
  query: CandidateQuery,
): Promise<readonly string[]> {
  return selectAllEligibleCandidates(
    { candidates, hasNextPage: query.hasNextPage },
    async () => {
      const result = await query.fetchNextPage()
      if (result.error) throw result.error
      return {
        candidates: result.data?.pages.flatMap((page) => page.items) ?? [],
        hasNextPage: result.hasNextPage,
      }
    },
  )
}

export function toggleSelectedCandidate(
  current: ReadonlySet<string>,
  candidate: ImportCandidateDto,
  checked: boolean,
): SelectionResult {
  const next = new Set(current)
  if (!checked) {
    const changed = next.delete(candidate.candidateId)
    return { selectedIds: [...next], changed }
  }
  if (!isSelectableImportCandidate(candidate) || next.has(candidate.candidateId)) {
    return { selectedIds: [...next], changed: false }
  }
  next.add(candidate.candidateId)
  return { selectedIds: [...next], changed: true }
}

export function toggleLoadedCandidates(
  current: ReadonlySet<string>,
  loaded: readonly ImportCandidateDto[],
  checked: boolean,
): SelectionResult {
  const selectableIds = loaded
    .filter(isSelectableImportCandidate)
    .map((candidate) => candidate.candidateId)
  const next = new Set(current)
  let changed = false

  if (!checked) {
    for (const id of selectableIds) changed = next.delete(id) || changed
    return { selectedIds: [...next], changed }
  }

  for (const id of selectableIds) {
    if (next.has(id)) continue
    next.add(id)
    changed = true
  }
  return { selectedIds: [...next], changed }
}

export function selectionCheckState(
  selected: ReadonlySet<string>,
  loaded: readonly ImportCandidateDto[],
): boolean | 'indeterminate' {
  const selectableIds = loaded
    .filter(isSelectableImportCandidate)
    .map((candidate) => candidate.candidateId)
  if (selectableIds.length === 0) return false
  const selectedCount = selectableIds.filter((id) => selected.has(id)).length
  if (selectedCount === 0) return false
  return selectedCount === selectableIds.length ? true : 'indeterminate'
}

export function filterLoadedCandidates(
  candidates: readonly ImportCandidateDto[],
  query: string,
): readonly ImportCandidateDto[] {
  const normalized = query.normalize('NFKC').trim().toLocaleLowerCase()
  if (!normalized) return candidates
  return candidates.filter((candidate) =>
    [
      candidate.businessName,
      candidate.address,
      candidate.primaryCategory,
      candidate.accountDisplayName,
    ].some((value) => value?.normalize('NFKC').toLocaleLowerCase().includes(normalized)),
  )
}
