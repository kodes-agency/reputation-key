// The words an identity image is set in: the buttons, the help under them and what a
// refusal says. The formats and the size limit are printed from the values the file is
// checked against, so the help can never promise what the check refuses.
import { actionFailureMessage } from '#/components/hooks/use-action-mutation'

export const DEFAULT_ACCEPTED_TYPES: ReadonlyArray<string> = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]

/** The default limit for an identity image. */
export const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024

const FORMAT_NAMES: Readonly<Record<string, string>> = {
  jpeg: 'JPG',
  png: 'PNG',
  webp: 'WebP',
  gif: 'GIF',
}

const BYTES_PER_MB = 1024 * 1024

function formatName(mime: string): string {
  const subtype = mime.split('/')[1] ?? mime
  return FORMAT_NAMES[subtype] ?? subtype.toUpperCase()
}

/** "JPG, PNG, WebP or GIF". */
export function acceptedFormatsText(acceptedTypes: ReadonlyArray<string>): string {
  const names = acceptedTypes.map(formatName)
  if (names.length < 2) return names.join('')
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
}

const sizeText = (bytes: number) => `${bytes / BYTES_PER_MB} MB`

/** The line under the buttons: what may be chosen. */
export function imageSettingHelp(
  acceptedTypes: ReadonlyArray<string>,
  maxFileSize: number,
): string {
  return `${acceptedFormatsText(acceptedTypes)}, up to ${sizeText(maxFileSize)}.`
}

/** The names of one setting's buttons and states, for "avatar", "logo". */
export function imageSettingLabels(subject: string) {
  return {
    upload: `Upload ${subject}`,
    replace: `Replace ${subject}`,
    remove: `Remove ${subject}`,
    uploading: 'Uploading…',
    removing: 'Removing…',
    current: `Current ${subject}`,
    none: `No ${subject} yet`,
  } as const
}

/** Why a file cannot be chosen, or null when it can. */
export function invalidFileMessage(
  file: Readonly<Pick<File, 'type' | 'size'>>,
  acceptedTypes: ReadonlyArray<string>,
  maxFileSize: number,
): string | null {
  if (!acceptedTypes.includes(file.type)) {
    return `Choose a ${acceptedFormatsText(acceptedTypes)} image.`
  }
  if (file.size > maxFileSize) return `Choose an image under ${sizeText(maxFileSize)}.`
  return null
}

/** An upload is an immediate action: the server's sentence for a refusal, else ours. */
export const uploadFailureMessage = (subject: string) =>
  actionFailureMessage(`Couldn't upload that ${subject}.`)

export const removeFailureMessage = (subject: string) =>
  actionFailureMessage(`Couldn't remove that ${subject}.`)
