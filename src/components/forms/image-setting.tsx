// The one way to set an identity image: a person's avatar, an organization's logo
// (UI consistency scan: FORM-14). The Property look logo keeps its own dialog on purpose:
// it crops, sets a focal point and checks a light version.
//
// The picture, with Upload, or Replace and Remove, as Buttons named for what the image
// is, and one line of help (the formats and the limit the file is checked against). The
// setting owns what a refusal says and what it leaves behind: a rejected upload or
// removal is a toast in the words every action uses, and the picture stays as it was.
// `onUpload` stores the file and SAVES its address, resolving with the address to show;
// `onRemove` saves the removal. Neither toasts a failure: the setting does. A success
// toast ("Avatar updated") is the caller's mutation's.
//
// A mutation behind it that passes `errorMessage` as well would tell the person twice.
import type { ReactNode } from 'react'
import { ImageSettingView } from './image-setting/image-setting-view'
import {
  DEFAULT_ACCEPTED_TYPES,
  DEFAULT_MAX_FILE_SIZE,
  imageSettingHelp,
} from './image-setting/image-setting-copy'
import { useImageSetting } from './image-setting/use-image-setting'

type Props = Readonly<{
  /** What the image is, lower case: "avatar", "logo". It names the buttons. */
  subject: string
  /** What is saved now, or null. A new value from the page replaces what is shown. */
  imageUrl: string | null
  onUpload: (file: File, onProgress: (percent: number) => void) => Promise<string>
  onRemove: () => Promise<unknown>
  disabled?: boolean
  acceptedTypes?: ReadonlyArray<string>
  maxFileSize?: number
  /** Replaces the line of help, which says what the file is checked against. */
  help?: ReactNode
}>

export function ImageSetting({
  subject,
  imageUrl,
  onUpload,
  onRemove,
  disabled = false,
  acceptedTypes = DEFAULT_ACCEPTED_TYPES,
  maxFileSize = DEFAULT_MAX_FILE_SIZE,
  help,
}: Props) {
  const setting = useImageSetting({
    subject,
    imageUrl,
    acceptedTypes,
    maxFileSize,
    disabled,
    onUpload,
    onRemove,
  })

  return (
    <ImageSettingView
      subject={subject}
      imageUrl={setting.imageUrl}
      status={setting.status}
      progress={setting.progress}
      disabled={disabled}
      help={help ?? imageSettingHelp(acceptedTypes, maxFileSize)}
      dragOver={setting.dragOver}
      acceptedTypes={acceptedTypes}
      inputRef={setting.inputRef}
      chooseRef={setting.chooseRef}
      onChoose={setting.choose}
      onFile={setting.upload}
      onRemove={setting.remove}
      dropProps={setting.dropProps}
    />
  )
}
