// src/components/features/portal/PortalCreationWithPreview.tsx
import { useState, useEffect } from 'react'
import { CreatePortalForm } from './create-portal-form'
import { PublicPortalContent } from '#/components/features/guest'
import { Button } from '#/components/ui/button'
import { Eye, EyeOff } from 'lucide-react'
import type { Action } from '#/components/hooks/use-action'

type PortalCreationWithPreviewProps = Readonly<{
  propertyId: string
  mutation: Action<{
    data: {
      name: string
      slug?: string
      description?: string
      propertyId: string
    }
  }>
}>

const PREVIEW_STORAGE_KEY = 'portal-creation-preview-open'

export function PortalCreationWithPreview({
  propertyId,
  mutation,
}: PortalCreationWithPreviewProps) {
  const [showPreview, setShowPreview] = useState(() => {
    try {
      return localStorage.getItem(PREVIEW_STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })

  const [preview, setPreview] = useState({
    name: '',
    description: '',
    primaryColor: '#6366f1',
  })

  useEffect(() => {
    try {
      localStorage.setItem(PREVIEW_STORAGE_KEY, String(showPreview))
    } catch {
      // ignore
    }
  }, [showPreview])

  const previewPortal = {
    id: 'preview',
    name: preview.name || 'Portal Name',
    description: preview.description || null,
    organizationName: 'Your Organization',
    heroImageUrl: null,
    theme: { primaryColor: preview.primaryColor },
  }

  return (
    <div className="flex gap-6">
      <div className={showPreview ? 'flex-1' : 'w-full'}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Create Portal</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Set up a new guest-facing portal page.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPreview(!showPreview)}
          >
            {showPreview ? (
              <EyeOff className="size-3.5 mr-1" />
            ) : (
              <Eye className="size-3.5 mr-1" />
            )}
            {showPreview ? 'Hide Preview' : 'Show Preview'}
          </Button>
        </div>
        <CreatePortalForm
          propertyId={propertyId}
          mutation={mutation}
          onPreviewChange={setPreview}
        />
      </div>

      {showPreview && (
        <div className="w-[400px] shrink-0 hidden lg:block">
          <div className="sticky top-8 bg-gray-100 rounded-lg p-4">
            <p className="text-xs text-muted-foreground text-center mb-2">Live Preview</p>
            <div className="bg-white rounded-lg shadow-lg overflow-hidden max-h-[80vh] overflow-y-auto">
              <PublicPortalContent
                portal={previewPortal}
                categories={[{ id: 'placeholder', title: 'Your links will appear here' }]}
                links={[]}
                source="direct"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
