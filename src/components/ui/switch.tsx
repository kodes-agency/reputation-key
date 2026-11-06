import * as React from 'react'
import { Switch as SwitchPrimitive } from 'radix-ui'

import { cn } from '#/lib/utils'

// A disabled switch is dimmed, but a switch that is on and cannot change ("Always on")
// must still read as on: halving a lit track and its thumb left a grey thumb on a dim
// purple track. A disabled switch that is off keeps the full dimming.
function Switch({
  className,
  size = 'default',
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: 'sm' | 'default'
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        // Keep the track compact while a 44 px pad accepts the tap. The pad grows from
        // the track's right edge, where row layouts put the switch, so it never widens
        // the row or the page.
        'relative after:absolute after:top-1/2 after:right-0 after:size-11 after:-translate-y-1/2',
        'peer group/switch inline-flex shrink-0 items-center rounded-full border border-transparent data-[state=unchecked]:border-border-control shadow-xs transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed data-[state=unchecked]:disabled:opacity-50 data-[state=checked]:disabled:opacity-75 data-[size=default]:h-[1.15rem] data-[size=default]:w-8 data-[size=sm]:h-3.5 data-[size=sm]:w-6 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input dark:data-[state=unchecked]:bg-input/80',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none block rounded-full bg-background ring-0 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0 dark:data-[state=checked]:bg-primary-foreground dark:data-[state=unchecked]:bg-foreground',
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
