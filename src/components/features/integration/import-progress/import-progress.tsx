import type { GbpImportJob } from '#/shared/domain'
import { Card } from '#/components/ui/card'
import { ImportStatusBadge } from './import-status-badge'
import { Button } from '#/components/ui/button'
import { Link } from '@tanstack/react-router'
import { CheckCircle2, XCircle, AlertCircle } from 'lucide-react'

interface ImportProgressProps {
  job: GbpImportJob
}

export function ImportProgress({ job }: ImportProgressProps) {
  const isComplete = job.status === 'completed' || job.status === 'completed_with_skips'
  const hasFailures = job.failedCount > 0
  const isFinal = isComplete || job.status === 'failed'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Import Progress</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {isComplete && !hasFailures
              ? 'Import completed successfully'
              : isComplete && hasFailures
                ? 'Import completed with some failures'
                : job.status === 'failed'
                  ? 'Import failed'
                  : 'Importing properties from Google Business Profile...'}
          </p>
        </div>
        <ImportStatusBadge status={job.status} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-green-600" />
            <div>
              <p className="text-2xl font-semibold">{job.importedCount}</p>
              <p className="text-sm text-muted-foreground">Imported</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 text-yellow-600" />
            <div>
              <p className="text-2xl font-semibold">{job.skippedCount}</p>
              <p className="text-sm text-muted-foreground">Skipped</p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2">
            <XCircle className="size-4 text-red-600" />
            <div>
              <p className="text-2xl font-semibold">{job.failedCount}</p>
              <p className="text-sm text-muted-foreground">Failed</p>
            </div>
          </div>
        </Card>
      </div>

      {isFinal && (
        <div className="flex items-center gap-3">
          <Button asChild>
            <Link to="/properties">Go to Properties</Link>
          </Button>
        </div>
      )}
    </div>
  )
}
