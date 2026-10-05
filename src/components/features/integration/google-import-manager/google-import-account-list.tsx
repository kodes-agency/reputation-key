import { Building2, ChevronRight } from 'lucide-react'
import type { ImportAccountDto } from '#/contexts/integration/application/public-api'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { LoadMoreButton } from '#/components/ui/load-more-button'
import { EmptyState } from '#/components/ui/empty-state'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { GoogleImportLoadingRows } from './google-import-loading-rows'

type Props = Readonly<{
  accounts: readonly ImportAccountDto[]
  selectedAccountRef: string | null
  isLoading: boolean
  isLoadingMore: boolean
  hasMore: boolean
  error: string | null
  onSelect: (accountRef: string) => void
  onLoadMore: () => void
}>

export function GoogleImportAccountList({
  accounts,
  selectedAccountRef,
  isLoading,
  isLoadingMore,
  hasMore,
  error,
  onSelect,
  onLoadMore,
}: Props) {
  return (
    <Card className="gap-4 lg:self-start">
      <CardHeader>
        <CardTitle as="h2">Business accounts</CardTitle>
        <CardDescription>
          Choose the account that owns the locations you want to import.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Accounts unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : isLoading ? (
          <GoogleImportLoadingRows label="Loading Google accounts" />
        ) : accounts.length === 0 ? (
          <EmptyState
            size="compact"
            icon={Building2}
            title="No accessible Business Profile accounts"
          />
        ) : (
          <div className="space-y-2">
            {accounts.map((account) => {
              const active = selectedAccountRef === account.accountRef
              return (
                <button
                  key={account.accountRef}
                  type="button"
                  aria-pressed={active}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-[active=true]:border-primary data-[active=true]:bg-primary/5"
                  data-active={active}
                  onClick={() => onSelect(account.accountRef)}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {account.displayName}
                    </span>
                    <span className="block text-xs capitalize text-muted-foreground">
                      {account.role.replaceAll('_', ' ')}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
                </button>
              )
            })}
          </div>
        )}
        {hasMore ? (
          <LoadMoreButton
            size="default"
            block
            label="Load more accounts"
            loading={isLoadingMore}
            onLoadMore={onLoadMore}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}
