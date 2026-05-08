import { Button } from '#/components/ui/button'
import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'

type Props = Readonly<{ showSubtitle?: boolean }>

export function ImportPageHeader({ showSubtitle }: Props) {
  return (
    <div className="flex items-center gap-4">
      <Button variant="ghost" size="icon" asChild aria-label="Back to properties">
        <Link to="/properties">
          <ArrowLeft className="size-4" />
        </Link>
      </Button>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Import Properties</h1>
        {showSubtitle && (
          <p className="mt-1 text-sm text-muted-foreground">
            Import properties from your Google Business Profile
          </p>
        )}
      </div>
    </div>
  )
}
