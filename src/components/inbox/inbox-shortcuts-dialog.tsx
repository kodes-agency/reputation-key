import { Dialog, DialogContent, DialogHeader, DialogTitle } from '#/components/ui/dialog'
import { Kbd } from '#/components/ui/kbd'

const SHORTCUTS = [
  ['j', 'Next item'],
  ['k', 'Previous item'],
  ['Enter', 'Open item'],
  ['x', 'Select item'],
  ['r', 'Reply'],
  ['n', 'Add note'],
  ['e', 'Escalate or resolve'],
  ['Esc', 'Close detail'],
  ['?', 'Show this list'],
] as const

export function InboxShortcutsDialog({
  open,
  onOpenChange,
}: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void }>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3">
          {SHORTCUTS.map(([key, label]) => (
            <div key={key} className="contents">
              <dt>
                <Kbd>{key}</Kbd>
              </dt>
              <dd className="text-sm text-muted-foreground">{label}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  )
}
