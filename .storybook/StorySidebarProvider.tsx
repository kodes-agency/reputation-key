import { useState, type ComponentProps } from 'react'
import { SidebarProvider } from '#/components/ui/sidebar'

type StorySidebarProviderProps = Omit<
  ComponentProps<typeof SidebarProvider>,
  'open' | 'onOpenChange'
> & { defaultOpen?: boolean }

/** The shell owns the sidebar's open state in the app; a story keeps its own. */
export function StorySidebarProvider({
  defaultOpen = true,
  ...props
}: StorySidebarProviderProps) {
  const [open, setOpen] = useState(defaultOpen)
  return <SidebarProvider open={open} onOpenChange={setOpen} {...props} />
}
