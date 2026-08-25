import type { ImportCandidateDto } from '#/contexts/integration/application/public-api'
import { MAX_GOOGLE_IMPORT_ITEMS } from '#/contexts/integration/application/dto/google-import-v2.dto'

type SelectionResult = Readonly<{
  selectedIds: readonly string[]
  changed: boolean
  limitReached: boolean
}>

export function isSelectableImportCandidate(candidate: ImportCandidateDto): boolean {
  return (
    candidate.candidateRef !== null &&
    (candidate.eligibility.kind === 'create' || candidate.eligibility.kind === 'relink')
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
    return { selectedIds: [...next], changed, limitReached: false }
  }
  if (!isSelectableImportCandidate(candidate) || next.has(candidate.candidateId)) {
    return { selectedIds: [...next], changed: false, limitReached: false }
  }
  if (next.size >= MAX_GOOGLE_IMPORT_ITEMS) {
    return { selectedIds: [...next], changed: false, limitReached: true }
  }
  next.add(candidate.candidateId)
  return { selectedIds: [...next], changed: true, limitReached: false }
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
  let limitReached = false

  if (!checked) {
    for (const id of selectableIds) changed = next.delete(id) || changed
    return { selectedIds: [...next], changed, limitReached }
  }

  for (const id of selectableIds) {
    if (next.has(id)) continue
    if (next.size >= MAX_GOOGLE_IMPORT_ITEMS) {
      limitReached = true
      break
    }
    next.add(id)
    changed = true
  }
  if (selectableIds.some((id) => !next.has(id))) limitReached = true
  return { selectedIds: [...next], changed, limitReached }
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
