import type { ImportCandidateDto } from '#/contexts/integration/application/public-api'

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
