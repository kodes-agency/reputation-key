import { AlertCircle, Loader2, MapPin, Search } from 'lucide-react'
import type {
  ImportAccountDto,
  ImportCandidateDto,
} from '#/contexts/integration/application/public-api'
import { MAX_GOOGLE_IMPORT_ITEMS } from '#/contexts/integration/application/dto/google-import-v2.dto'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { GoogleImportAccountList } from './google-import-account-list'
import { GoogleImportCandidateList } from './google-import-candidate-list'
import { GoogleImportLoadingRows } from './google-import-loading-rows'

type Props = Readonly<{
  accounts: readonly ImportAccountDto[]
  candidates: readonly ImportCandidateDto[]
  selectedAccountRef: string | null
  selectedIds: ReadonlySet<string>
  search: string
  isLoadingAccounts: boolean
  isLoadingMoreAccounts: boolean
  hasMoreAccounts: boolean
  isLoadingCandidates: boolean
  isLoadingMoreCandidates: boolean
  hasMoreCandidates: boolean
  accountsError: string | null
  candidatesError: string | null
  onSearchChange: (value: string) => void
  onSelectAccount: (accountRef: string) => void
  onToggleCandidate: (candidate: ImportCandidateDto, checked: boolean) => void
  onToggleLoaded: (checked: boolean) => void
  onLoadMoreAccounts: () => void
  onLoadMoreCandidates: () => void
  onReview: () => void
}>

export function GoogleImportDiscoveryPanel(props: Props) {
  const selectedAccount = props.accounts.find(
    (account) => account.accountRef === props.selectedAccountRef,
  )

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(15rem,0.34fr)_minmax(0,1fr)]">
      <GoogleImportAccountList
        accounts={props.accounts}
        selectedAccountRef={props.selectedAccountRef}
        isLoading={props.isLoadingAccounts}
        isLoadingMore={props.isLoadingMoreAccounts}
        hasMore={props.hasMoreAccounts}
        error={props.accountsError}
        onSelect={props.onSelectAccount}
        onLoadMore={props.onLoadMoreAccounts}
      />

      <Card className="min-w-0 gap-4">
        <CardHeader>
          <CardTitle>
            {selectedAccount ? selectedAccount.displayName : 'Locations'}
          </CardTitle>
          <CardDescription>
            Search and select from loaded locations. Up to {MAX_GOOGLE_IMPORT_ITEMS}{' '}
            properties can be imported at once.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!props.selectedAccountRef ? (
            <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed px-6 text-center">
              <MapPin className="mb-3 size-7 text-muted-foreground" aria-hidden="true" />
              <p className="font-medium">Choose a business account</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Its locations will appear here. Provider identifiers stay hidden.
              </p>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={props.search}
                  onChange={(event) => props.onSearchChange(event.currentTarget.value)}
                  placeholder="Search loaded names, addresses, or categories"
                  aria-label="Search loaded Google locations"
                  className="pl-9"
                />
              </div>

              {props.candidatesError ? (
                <Alert variant="destructive">
                  <AlertCircle aria-hidden="true" />
                  <AlertTitle>Locations unavailable</AlertTitle>
                  <AlertDescription>{props.candidatesError}</AlertDescription>
                </Alert>
              ) : props.isLoadingCandidates ? (
                <GoogleImportLoadingRows label="Loading Google locations" />
              ) : props.candidates.length === 0 ? (
                <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No matching loaded locations. Clear the search or load another page.
                </p>
              ) : (
                <GoogleImportCandidateList
                  candidates={props.candidates}
                  selectedIds={props.selectedIds}
                  onToggleCandidate={props.onToggleCandidate}
                  onToggleLoaded={props.onToggleLoaded}
                />
              )}

              <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div aria-live="polite" className="text-sm text-muted-foreground">
                  <p>
                    {props.selectedIds.size} selected · {props.candidates.length} matching
                    loaded
                  </p>
                  <p className="mt-0.5 text-xs">
                    Searching and select all never fetch additional pages.
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  {props.hasMoreCandidates ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={props.isLoadingMoreCandidates}
                      onClick={props.onLoadMoreCandidates}
                    >
                      {props.isLoadingMoreCandidates ? (
                        <Loader2 className="animate-spin" aria-hidden="true" />
                      ) : null}
                      Load more locations
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    disabled={props.selectedIds.size === 0}
                    onClick={props.onReview}
                  >
                    Review {props.selectedIds.size || ''}{' '}
                    {props.selectedIds.size === 1 ? 'property' : 'properties'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
