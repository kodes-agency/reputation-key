// Handing a file to the browser's download. Detached anchors still activate in
// current browsers, but that is not guaranteed, so the anchor is attached for
// the click.

const OBJECT_URL_LIFETIME_MS = 10_000

export function saveFile(href: string, fileName: string): void {
  const link = document.createElement('a')
  link.href = href
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
}

/** Saves bytes under a name; the temporary address is released once the browser has taken them. */
export function saveBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob)
  saveFile(objectUrl, fileName)
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), OBJECT_URL_LIFETIME_MS)
}
