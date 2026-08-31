// LIF-01-T17 — Organization Export request, retrieval and download.
//
// What this panel shows and does NOT show is the whole design:
//   * checksums and coverage ARE shown, because they are how a tenant verifies
//     that the archive they downloaded is the one this system built;
//   * object keys, retrieval token digests, encryption evidence and support
//     evidence references are NEVER shown, because each is a second route to
//     the archive or operator control-plane material. The server view type
//     omits them entirely, so this component cannot render them by accident.
//
// The retrieval link is single-use and valid for 24 hours. The token is
// therefore held in component state only for the moment between issuing and
// downloading; it is never written to the URL, where it would land in history
// and server logs.

import { useState } from 'react'
import { Download, FileArchive, KeyRound, RefreshCw } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import type { AnyAction } from '#/components/hooks/use-action'
import type { OrganizationExportView } from '#/contexts/identity/application/dto/organization-closure.dto'
import { formatDeadline } from './closure-status-card'
import { EXPORT_STATE_COPY, canRequestNewExport } from './organization-export-state'

type Props = Readonly<{
  organizationExport: OrganizationExportView | null
  timezone: string
  requestExport: AnyAction
  issueRetrieval: AnyAction
  downloadExport: AnyAction
  /** Hands the decoded archive to the browser. Injected so stories stay pure. */
  onArchive?: (input: Readonly<{ filename: string; archiveBase64: string }>) => void
}>

export function OrganizationExportPanel({
  organizationExport,
  timezone,
  requestExport,
  issueRetrieval,
  downloadExport,
  onArchive,
}: Props) {
  const [token, setToken] = useState<string | null>(null)
  const [tokenExpiresAt, setTokenExpiresAt] = useState<string | null>(null)

  const state = organizationExport?.state ?? null
  const copy = state ? EXPORT_STATE_COPY[state] : null
  const canRequest = canRequestNewExport(state)
  const canIssue = state === 'ready'

  const onIssue = async () => {
    if (!organizationExport) return
    const issued = (await issueRetrieval({
      data: { requestId: organizationExport.requestId },
    })) as Readonly<{ token: string; expiresAt: string }>
    setToken(issued.token)
    setTokenExpiresAt(issued.expiresAt)
  }

  const onDownload = async () => {
    if (!organizationExport || !token) return
    const archive = (await downloadExport({
      data: { requestId: organizationExport.requestId, token },
    })) as Readonly<{ filename: string; archiveBase64: string }>
    // Single use: the token is spent the moment the server accepts it, so it
    // is dropped here too rather than lingering in memory for a second click.
    setToken(null)
    setTokenExpiresAt(null)
    onArchive?.(archive)
  }

  return (
    <Card data-testid="organization-export-panel">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <FileArchive aria-hidden="true" className="size-5" />
              Organization export
            </CardTitle>
            <CardDescription>
              {copy?.description ??
                'Download everything this workspace holds before it is deleted.'}
            </CardDescription>
          </div>
          {copy ? (
            <Badge variant="outline" data-testid="export-state-badge">
              {copy.label}
            </Badge>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {organizationExport ? (
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground text-xs uppercase tracking-wide">
                Snapshot taken
              </dt>
              <dd data-testid="export-as-of">
                {formatDeadline(organizationExport.asOf, timezone)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs uppercase tracking-wide">
                Archive available until
              </dt>
              <dd data-testid="export-object-expires-at">
                {formatDeadline(organizationExport.objectExpiresAt, timezone)}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground text-xs uppercase tracking-wide">
                Coverage checksum
              </dt>
              <dd className="font-mono text-xs break-all" data-testid="export-coverage">
                {organizationExport.coverageSha256 ?? 'Not available yet'}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground text-xs uppercase tracking-wide">
                Archive checksum (SHA-256)
              </dt>
              <dd className="font-mono text-xs break-all" data-testid="export-checksum">
                {organizationExport.archiveSha256 ?? 'Not available yet'}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-muted-foreground text-sm">
            No export has been requested for this organization.
          </p>
        )}

        {organizationExport?.lastErrorCode ? (
          <Alert variant="destructive" data-testid="export-error">
            <AlertTitle>Export failed</AlertTitle>
            <AlertDescription>
              Reference code {organizationExport.lastErrorCode}. Request a new export.
            </AlertDescription>
          </Alert>
        ) : null}

        {token ? (
          <Alert data-testid="export-retrieval-issued">
            <KeyRound aria-hidden="true" />
            <AlertTitle>Single-use link ready</AlertTitle>
            <AlertDescription>
              It works once and expires {formatDeadline(tokenExpiresAt, timezone)}.
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>

      <CardFooter className="flex flex-wrap gap-2">
        <Button
          onClick={() => void requestExport({})}
          disabled={!canRequest || requestExport.isPending}
          data-testid="request-export"
        >
          <RefreshCw aria-hidden="true" />
          Request export
        </Button>
        <Button
          variant="outline"
          onClick={() => void onIssue()}
          disabled={!canIssue || issueRetrieval.isPending}
          data-testid="issue-export-retrieval"
        >
          <KeyRound aria-hidden="true" />
          Get download link
        </Button>
        <Button
          variant="outline"
          onClick={() => void onDownload()}
          disabled={token === null || downloadExport.isPending}
          data-testid="download-export"
        >
          <Download aria-hidden="true" />
          Download archive
        </Button>
      </CardFooter>
    </Card>
  )
}
