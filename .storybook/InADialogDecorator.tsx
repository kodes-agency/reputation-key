import type { Decorator } from '@storybook/react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../src/components/ui/dialog'

/**
 * Draws a story's component as the body of an open dialog, which is where a
 * dialog's form ships: its Cancel closes a dialog, and so needs one to close.
 * The dialog portals out of the story canvas, so a play reads `document.body`.
 */
export const inADialog =
  (title: string): Decorator =>
  (Story) => (
    <Dialog open>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Story />
      </DialogContent>
    </Dialog>
  )
