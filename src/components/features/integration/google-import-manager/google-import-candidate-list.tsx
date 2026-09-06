import type { ImportCandidateDto } from '#/contexts/integration/application/public-api'
import { Badge } from '#/components/ui/badge'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import {
  isSelectableImportCandidate,
  selectionCheckState,
} from './google-import-selection'

type Props = Readonly<{
  candidates: readonly ImportCandidateDto[]
  selectedIds: ReadonlySet<string>
  onToggleCandidate: (candidate: ImportCandidateDto, checked: boolean) => void
  onToggleLoaded: (checked: boolean) => void
}>

function eligibilityLabel(candidate: ImportCandidateDto): string {
  switch (candidate.eligibility.kind) {
    case 'create':
      return 'New property'
    case 'relink':
      return 'Link existing'
    case 'already_imported':
      return 'Already imported'
    case 'active_binding_conflict':
      return 'Linked elsewhere'
    case 'verification_required':
      return 'Needs Google verification'
    case 'unavailable':
      return 'Unavailable'
  }
}

export function GoogleImportCandidateList({
  candidates,
  selectedIds,
  onToggleCandidate,
  onToggleLoaded,
}: Props) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                <Checkbox
                  checked={selectionCheckState(selectedIds, candidates)}
                  aria-label="Select all loaded importable locations"
                  onCheckedChange={(checked) => onToggleLoaded(checked === true)}
                />
              </TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {candidates.map((candidate) => {
              const selectable = isSelectableImportCandidate(candidate)
              return (
                <TableRow
                  key={candidate.candidateId}
                  data-state={
                    selectedIds.has(candidate.candidateId) ? 'selected' : undefined
                  }
                >
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(candidate.candidateId)}
                      disabled={!selectable}
                      aria-label={`Select ${candidate.businessName}`}
                      onCheckedChange={(checked) =>
                        onToggleCandidate(candidate, checked === true)
                      }
                    />
                  </TableCell>
                  <TableCell className="max-w-80 whitespace-normal">
                    <p className="font-medium">{candidate.businessName}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {candidate.address || 'Address unavailable'}
                    </p>
                  </TableCell>
                  <TableCell className="max-w-48 whitespace-normal text-muted-foreground">
                    {candidate.primaryCategory || 'Uncategorized'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={selectable ? 'secondary' : 'outline'}>
                      {eligibilityLabel(candidate)}
                    </Badge>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-3 md:hidden">
        {candidates.map((candidate) => {
          const selectable = isSelectableImportCandidate(candidate)
          return (
            <label
              key={candidate.candidateId}
              className="flex min-h-11 items-start gap-3 rounded-lg border p-4 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5"
            >
              <Checkbox
                className="mt-0.5"
                checked={selectedIds.has(candidate.candidateId)}
                disabled={!selectable}
                aria-label={`Select ${candidate.businessName}`}
                onCheckedChange={(checked) =>
                  onToggleCandidate(candidate, checked === true)
                }
              />
              <span className="min-w-0 flex-1">
                <span className="block break-words font-medium">
                  {candidate.businessName}
                </span>
                <span className="mt-1 block break-words text-sm text-muted-foreground">
                  {candidate.address || 'Address unavailable'}
                </span>
                <Badge className="mt-2" variant={selectable ? 'secondary' : 'outline'}>
                  {eligibilityLabel(candidate)}
                </Badge>
              </span>
            </label>
          )
        })}
      </div>
    </>
  )
}
