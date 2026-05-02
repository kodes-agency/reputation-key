import { Button } from '#/components/ui/button'
import { Home } from 'lucide-react'
import { Link } from '@tanstack/react-router'

export function PortalNotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold text-gray-900">Portal Not Found</h1>
        <p className="text-gray-600">This portal doesn't exist or has been removed.</p>
        <Button asChild>
          <Link to="/">
            <Home className="size-4 mr-2" />
            Go Home
          </Link>
        </Button>
      </div>
    </div>
  )
}
