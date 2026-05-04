// Hook for file upload validation and handling.

import { useState, useCallback } from 'react'
import { toast } from 'sonner'

type UseFileUploadOptions = Readonly<{
  acceptedTypes: string[]
  maxFileSize: number
  onUpload: (file: File, onProgress: (percent: number) => void) => Promise<string>
  onImageUrlChange: (url: string | null) => void
}>

type UseFileUploadReturn = Readonly<{
  uploading: boolean
  uploadProgress: number
  handleFileSelect: (file: File) => Promise<void>
}>

export function useFileUpload({
  acceptedTypes,
  maxFileSize,
  onUpload,
  onImageUrlChange,
}: UseFileUploadOptions): UseFileUploadReturn {
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)

  const validateFile = (file: File): boolean => {
    if (!acceptedTypes.includes(file.type)) {
      toast.error(`Please select a valid image file (${acceptedTypes.join(', ')})`)
      return false
    }
    if (file.size > maxFileSize) {
      toast.error(`File size must be less than ${maxFileSize / 1024 / 1024} MB`)
      return false
    }
    return true
  }

  const handleFileSelect = useCallback(
    async (file: File) => {
      if (!validateFile(file)) return

      setUploading(true)
      setUploadProgress(0)
      try {
        const url = await onUpload(file, (p) => setUploadProgress(p))
        onImageUrlChange(url)
      } catch (err: unknown) {
        const message =
          (err instanceof Error ? err.message : '') ||
          (typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : '') ||
          'Upload failed. Please try again.'
        toast.error(message)
      } finally {
        setUploading(false)
        setUploadProgress(0)
      }
    },
    [acceptedTypes, maxFileSize, onUpload, onImageUrlChange],
  )

  return {
    uploading,
    uploadProgress,
    handleFileSelect,
  }
}
