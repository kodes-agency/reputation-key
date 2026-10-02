// Board 11: on a phone, New portal waits in a bar at the bottom of the screen,
// where a thumb reaches it, instead of at the top of a long list. From `sm` up
// the page header's button is the only one.
import { Plus } from 'lucide-react'
import { Button } from '#/components/ui/button'

/** The page's bottom padding on a phone, so the list's last row clears the bar. */
export const PHONE_NEW_PORTAL_BAR_CLEARANCE = 'pb-20 sm:pb-0'

export function PortalPhoneNewPortalBar({ onClick }: Readonly<{ onClick: () => void }>) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:hidden">
      <Button className="min-h-11 w-full" onClick={onClick}>
        <Plus />
        New portal
      </Button>
    </div>
  )
}
