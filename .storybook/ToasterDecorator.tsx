// Storybook decorator that mounts the app's Toaster beside a story. The real one
// lives in the root route, which a story does not render; a story whose subject
// reports by toast (a row or immediate action) wears this to assert the toast.
import type { ReactNode } from 'react'
import { Toaster } from '#/components/ui/sonner'

export function ToasterDecorator(Story: () => ReactNode) {
  return (
    <>
      <Story />
      <Toaster position="top-right" />
    </>
  )
}
