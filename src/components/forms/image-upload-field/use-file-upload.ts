// Hook for file upload validation and handling.

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { actionFailureMessage } from '#/components/hooks/use-action-mutation'

export const uploadFailureMessage = actionFailureMessage("Couldn't upload that image.")

type UseFileUploadOptions = Readonly<{
  acceptedTypes: ReadonlyArray<string>
  maxFileSize: number
  onUpload: (file: File, onProgress: (percent: number) => void) => Promise<string | null>
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

  const validateFile = useCallback(
    (file: File): boolean => {
      if (!acceptedTypes.includes(file.type)) {
        toast.error(`Please select a valid image file (${acceptedTypes.join(', ')})`)
        return false
      }
      if (file.size > maxFileSize) {
        toast.error(`File size must be less than ${maxFileSize / 1024 / 1024} MB`)
        return false
      }
      return true
    },
    [acceptedTypes, maxFileSize],
  )

  const handleFileSelect = useCallback(
    async (file: File) => {
      if (!validateFile(file)) return

      setUploading(true)
      setUploadProgress(0)
      try {
        const url = await onUpload(file, (p) => setUploadProgress(p))
        // Issuance-bound Portal uploads keep the previous image visible while
        // the private source is decoded and a public derivative is prepared.
        if (url !== null) onImageUrlChange(url)
      } catch (error: unknown) {
        // An upload from this field is an immediate action: a toast, in the
        // words every other action uses. A refusal the server wrote for the
        // person keeps its sentence; a network or storage failure says what
        // failed instead of echoing its internal text.
        toast.error(uploadFailureMessage(error))
      } finally {
        setUploading(false)
        setUploadProgress(0)
      }
    },
    [onUpload, onImageUrlChange, validateFile],
  )

  return {
    uploading,
    uploadProgress,
    handleFileSelect,
  }
}
