// Hook for drag-and-drop handling.

import { useState, useCallback } from 'react'

type UseDragDropOptions = Readonly<{
  disabled: boolean
  uploading: boolean
  onDropFile: (file: File) => void
}>

type UseDragDropReturn = Readonly<{
  dragOver: boolean
  handleDragOver: (e: React.DragEvent) => void
  handleDragLeave: (e: React.DragEvent) => void
  handleDrop: (e: React.DragEvent) => void
}>

export function useDragDrop({
  disabled,
  uploading,
  onDropFile,
}: UseDragDropOptions): UseDragDropReturn {
  const [dragOver, setDragOver] = useState(false)

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!disabled && !uploading) {
        setDragOver(true)
      }
    },
    [disabled, uploading],
  )

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragOver(false)

      if (disabled || uploading) return

      const file = e.dataTransfer.files[0]
      if (file) {
        onDropFile(file)
      }
    },
    [disabled, uploading, onDropFile],
  )

  return {
    dragOver,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  }
}
