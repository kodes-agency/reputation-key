import { Globe } from 'lucide-react'

export function PortalUnavailable() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="flex flex-col items-center space-y-4 text-center">
        <Globe className="size-16 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">Portal Unavailable</h1>
        <p className="text-sm text-muted-foreground">Please try again later.</p>
      </div>
    </div>
  )
}
