// S3 presigned URL upload via XHR with optional progress tracking.

export type PresignedUploadHeaders = Readonly<Record<string, string>>

export function buildPresignedUploadHeaders(
  file: Readonly<Pick<File, 'type'>>,
  requiredHeaders: PresignedUploadHeaders = {},
): Readonly<Record<string, string>> {
  for (const [name, value] of Object.entries(requiredHeaders)) {
    if (name.toLowerCase() === 'content-type' && value !== file.type) {
      throw new Error('Presigned upload Content-Type conflicts with the selected file')
    }
  }
  return {
    'Content-Type': file.type,
    ...requiredHeaders,
  }
}

export function putFilePresigned(
  url: string,
  file: File,
  onProgress?: (percent: number) => void,
  requiredHeaders: PresignedUploadHeaders = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    for (const [name, value] of Object.entries(
      buildPresignedUploadHeaders(file, requiredHeaders),
    )) {
      xhr.setRequestHeader(name, value)
    }
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100))
        }
      }
    }
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed: ${xhr.status}`))
    xhr.onerror = () => reject(new Error('Network error'))
    xhr.send(file)
  })
}
