import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '#/components/ui/sheet'
import { PublicPortalContent } from '#/components/guest/PublicPortalContent'
import type {
  PortalCategory,
  PortalLinkItem,
} from '#/components/guest/PublicPortalContent'

type PortalPreviewPanelProps = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  portal: {
    id: string
    name: string
    description: string | null
    organizationName: string
    heroImageUrl: string | null
    theme: Record<string, string> | null
  }
  categories: PortalCategory[]
  links: PortalLinkItem[]
}>

export function PortalPreviewPanel({
  open,
  onOpenChange,
  portal,
  categories,
  links,
}: PortalPreviewPanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[480px] sm:max-w-[480px] p-0 overflow-y-auto"
      >
        <SheetHeader className="p-4 pb-0">
          <SheetTitle>Preview</SheetTitle>
          <SheetDescription>
            This is how guests will see your portal on mobile.
          </SheetDescription>
        </SheetHeader>
        <div className="flex justify-center p-4 bg-gray-100 min-h-[calc(100vh-80px)]">
          <div className="w-[400px] max-w-full bg-white rounded-lg shadow-lg overflow-hidden">
            <PublicPortalContent
              portal={portal}
              categories={categories}
              links={links}
              source="direct"
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
