import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

type ToolbarContextValue = Readonly<{
  target: HTMLDivElement | null
  setTarget: (target: HTMLDivElement | null) => void
}>

const ReplyToolbarContext = createContext<ToolbarContextValue | null>(null)

type ProviderProps = Readonly<{ children: ReactNode }>

export function ReplyToolbarProvider({ children }: ProviderProps) {
  const [target, setTargetState] = useState<HTMLDivElement | null>(null)
  const setTarget = useCallback((nextTarget: HTMLDivElement | null) => {
    setTargetState(nextTarget)
  }, [])
  const value = useMemo(() => ({ target, setTarget }), [setTarget, target])

  return (
    <ReplyToolbarContext.Provider value={value}>{children}</ReplyToolbarContext.Provider>
  )
}

type SlotProps = Readonly<{ className?: string }>

export function ReplyToolbarSlot({ className }: SlotProps) {
  const context = useContext(ReplyToolbarContext)
  return <div ref={context?.setTarget} className={className} />
}

type PortalProps = Readonly<{ children: ReactNode }>

export function ReplyToolbarPortal({ children }: PortalProps) {
  const context = useContext(ReplyToolbarContext)
  if (!context) return children
  if (!context.target) return null
  return createPortal(children, context.target)
}
