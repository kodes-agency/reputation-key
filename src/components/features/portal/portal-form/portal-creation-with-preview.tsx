// Create-portal editor with an optional live preview beside the form.
import { useState } from 'react'
import { CreatePortalForm, CREATE_PORTAL_DEFAULT_THEME } from './create-portal-form'
import { usePreviewToggle } from '../portal-preview/use-preview-toggle'
import { PublicPortalContent } from '#/components/features/guest'
import { Button } from '#/components/ui/button'
import { Eye, EyeOff } from 'lucide-react'
import type { Action } from '#/components/hooks/use-action'
import type { PortalThemeDraft } from '../shared/types'

type PortalCreationWithPreviewProps = Readonly<{
  propertyId: string
  mutation: Action<{
    data: {
      name: string
      slug?: string
      description?: string
      propertyId: string
      theme?: PortalThemeDraft
    }
  }>
}>

export function PortalCreationWithPreview({
  propertyId,
  mutation,
}: PortalCreationWithPreviewProps) {
  // Reuses the detail page's toggle hook rather than reading localStorage in a
  // useState initialiser: unguarded, SSR resolved false while the client
  // hydrated true, which React flags as a hydration mismatch and the user sees
  // as a flash. 'new' is the storage scope — this editor has no portal id yet.
  const { previewOpen, setPreviewOpen } = usePreviewToggle('new')
  const [preview, setPreview] = useState<{
    name: string
    description: string
    theme: PortalThemeDraft
  }>({
    name: '',
    description: '',
    theme: CREATE_PORTAL_DEFAULT_THEME,
  })

  const previewPortal = {
    id: 'preview',
    name: preview.name || 'Portal Name',
    description: preview.description || null,
    organizationName: 'Your Organization',
    heroImageUrl: null,
    // Spread out explicitly: PublicPortalContent's theme is a string-valued
    // record, so an absent optional colour must become null, not undefined.
    theme: {
      primaryColor: preview.theme.primaryColor,
      backgroundColor: preview.theme.backgroundColor ?? null,
      textColor: preview.theme.textColor ?? null,
    },
  }

  return (
    <div className="flex gap-6">
      <div className={previewOpen ? 'flex-1' : 'w-full'}>
        {/*
          No heading here: the route's PageHeader already renders the page's only
          <h1>. The toggle is hidden below `lg` because the preview pane itself
          is `hidden lg:block` — a visible button that changes nothing reads as
          broken.
        */}
        <div className="mb-4 hidden justify-end lg:flex">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={previewOpen}
            onClick={() => setPreviewOpen(!previewOpen)}
          >
            {previewOpen ? (
              <EyeOff className="size-3.5 mr-1" />
            ) : (
              <Eye className="size-3.5 mr-1" />
            )}
            {previewOpen ? 'Hide Preview' : 'Show Preview'}
          </Button>
        </div>
        <CreatePortalForm
          propertyId={propertyId}
          mutation={mutation}
          onPreviewChange={setPreview}
        />
      </div>

      {previewOpen && (
        <div className="w-[400px] shrink-0 hidden lg:block">
          <div className="sticky top-8 bg-muted rounded-lg p-4">
            <p className="text-xs text-muted-foreground text-center mb-2">Live Preview</p>
            <div className="bg-white rounded-lg shadow-lg overflow-hidden max-h-[80vh] overflow-y-auto">
              <PublicPortalContent
                portal={previewPortal}
                categories={[{ id: 'placeholder', title: 'Your links will appear here' }]}
                links={[]}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
