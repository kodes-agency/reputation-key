import { useRef, useState } from 'react'
import { useStore } from '@tanstack/react-form'
import { DialogErrorBanner } from '#/components/forms/dialog-error-banner'
import { submitHandler } from '#/components/forms/form-submit'
import { SubmitButton } from '#/components/forms/submit-button'
import {
  Dialog,
  DialogCancel,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import type {
  ReplyLibraryDto,
  ReplyLibraryTemplateDto,
  SaveReplyTemplateInput,
} from '#/contexts/review/application/dto/reply-library.dto'
import { checkReplyText } from '#/shared/reply-library/reply-checks'
import { renderReply } from '#/shared/reply-library/render-reply'
import {
  groupEditorWordings,
  useReplyTemplateEditorForm,
  type EditorFinding,
  type EditorLanguage,
  type ReplyTemplateSaveAction,
} from './reply-template-editor-form'
import { ReplyTemplateEditorView } from './reply-template-editor-view'

export type ReplyTemplateEditorProps = Readonly<{
  propertyId: string
  propertyName: string
  propertyCount: number
  library: ReplyLibraryDto
  template: ReplyLibraryTemplateDto | null
  action: ReplyTemplateSaveAction
  trigger: React.ReactNode
}>

export function defaultWordings(
  template: ReplyLibraryTemplateDto | null,
): SaveReplyTemplateInput['wordings'] {
  if (!template) {
    // Stable across renders, so the untouched form never resets itself.
    const key = '1'
    return [
      { key, languageGroup: 'en-Latn', body: '' },
      { key, languageGroup: 'es-Latn', body: '' },
    ]
  }
  const existing = Object.entries(template.wordings).flatMap(
    ([languageGroup, wordings]) =>
      (wordings ?? []).map((wording) => ({ ...wording, languageGroup })),
  ) as SaveReplyTemplateInput['wordings']
  const keys = [...new Set(existing.map(({ key }) => key))]
  return keys.flatMap((key) => {
    const rows = existing.filter((wording) => wording.key === key)
    return [
      ...rows,
      ...(['en-Latn', 'es-Latn'] as const)
        .filter(
          (languageGroup) =>
            !rows.some((wording) => wording.languageGroup === languageGroup),
        )
        .map((languageGroup) => ({ key, languageGroup, body: '' })),
    ]
  })
}

export function templateActionScope(
  template: ReplyLibraryTemplateDto | null,
  propertyCount: number,
): SaveReplyTemplateInput['scope'] {
  if (template?.layer === 'property') return 'property'
  return propertyCount > 1 ? 'property' : 'account'
}

export function editorDefaults(
  props: Omit<ReplyTemplateEditorProps, 'trigger'>,
): SaveReplyTemplateInput {
  const { template } = props
  const scope = templateActionScope(template, props.propertyCount)
  const editingAtOwnLayer = template?.layer === scope
  const templateId =
    editingAtOwnLayer && template?.ref.startsWith('template:')
      ? template.ref.slice('template:'.length)
      : undefined
  return {
    propertyId: props.propertyId,
    scope,
    ...(template && (template.ref.startsWith('builtin:') || !editingAtOwnLayer)
      ? { base: template.ref }
      : {}),
    ...(templateId ? { templateId } : {}),
    title: template?.title ?? '',
    starsMin: template?.starsMin ?? 4,
    starsMax: template?.starsMax ?? 5,
    reviewKind: template?.reviewKind ?? 'text',
    topic: template?.topic ?? null,
    wordings: defaultWordings(template),
    ...(template && editingAtOwnLayer ? { expectedVersion: template.revision } : {}),
  }
}

// fallow-ignore-next-line complexity -- dialog-local form and preview state are discarded together on close
function ReplyTemplateEditorBody(
  props: Omit<ReplyTemplateEditorProps, 'trigger'> & { onClose: () => void },
) {
  const { propertyName, propertyCount, library, template, action, onClose } = props
  const form = useReplyTemplateEditorForm(editorDefaults(props), action, onClose)
  // One selector per value: a selector that builds a new array re-renders forever.
  const values = useStore(form.store, (state) => state.values)
  const submissionAttempts = useStore(form.store, (state) => state.submissionAttempts)
  const [language, setLanguage] = useState<EditorLanguage>('en-Latn')
  const [selected, setSelected] = useState(0)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const wordings = groupEditorWordings(values.wordings)
  const current = wordings[selected] ?? wordings[0] ?? null
  const body = current ? (language === 'en-Latn' ? current.en : current.es) : ''
  const findings = wordings.flatMap((wording) => [
    ...(wording.en.trim().length > 0
      ? [
          {
            language: 'English',
            ...checkReplyText({
              text: wording.en,
              kind: 'template_body',
              rating: values.starsMin,
              reviewKind: values.reviewKind,
              languageGroup: 'en-Latn',
              privacyMode: library.voice.privacyMode.value,
              emojiAllowed: false,
            }),
          },
        ]
      : []),
    ...(wording.es.trim().length > 0
      ? [
          {
            language: 'Español',
            ...checkReplyText({
              text: wording.es,
              kind: 'template_body',
              rating: values.starsMin,
              reviewKind: values.reviewKind,
              languageGroup: 'es-Latn',
              privacyMode: library.voice.privacyMode.value,
              emojiAllowed: false,
            }),
          },
        ]
      : []),
  ])
  const blocks: EditorFinding[] = findings.flatMap((item) =>
    item.blocks.map((finding) => ({ ...finding, language: item.language })),
  )
  const warnings: EditorFinding[] = findings.flatMap((item) =>
    item.warnings.map((finding) => ({ ...finding, language: item.language })),
  )
  let preview = body
  try {
    preview = renderReply({
      body,
      voice: library.voice,
      languageGroup: language,
      rating: values.starsMax,
      hasText: values.reviewKind === 'text',
      reviewerDisplayName: 'Maria Lopez',
      propertyDisplayName: propertyName,
      choices: { closing: 0, signOff: 0, contactSentence: 0, emoji: 0 },
    }).text
  } catch {
    /* Checks explain incomplete text while the editor stays usable. */
  }
  const updateBody = (value: string) => {
    if (!current) return
    form.setFieldValue(
      'wordings',
      values.wordings.map((wording) =>
        wording.key === current.key && wording.languageGroup === language
          ? { ...wording, body: value }
          : wording,
      ),
    )
  }
  const insertVariable = (variable: string) => {
    const control = bodyRef.current
    const start = control?.selectionStart ?? body.length
    const end = control?.selectionEnd ?? start
    updateBody(`${body.slice(0, start)}${variable}${body.slice(end)}`)
    window.requestAnimationFrame(() => {
      control?.focus()
      control?.setSelectionRange(start + variable.length, start + variable.length)
    })
  }

  return (
    <DialogContent size="xl" showCloseButton={false}>
      <form className="contents" onSubmit={submitHandler(form)}>
        <DialogHeader>
          <DialogTitle>{template ? 'Edit template' : 'Add template'}</DialogTitle>
          <DialogDescription>
            Write the reply body only. The reply voice adds the greeting and signature.
          </DialogDescription>
        </DialogHeader>
        {template?.ref.startsWith('builtin:') ? (
          <p className="text-sm text-muted-foreground">
            Saving keeps your version{propertyCount > 1 ? ' for this property' : ''};
            Reset brings back the built-in.
          </p>
        ) : null}
        <ReplyTemplateEditorView
          form={form}
          wordings={wordings}
          language={language}
          setLanguage={setLanguage}
          selected={selected}
          setSelected={setSelected}
          bodyRef={bodyRef}
          insertVariable={insertVariable}
          blocks={blocks}
          warnings={warnings}
          preview={preview}
          submissionAttempts={submissionAttempts}
        />
        <DialogErrorBanner error={action.error} />
        <DialogFooter>
          <DialogCancel />
          <SubmitButton
            mutation={action}
            form={form}
            pendingLabel="Saving…"
            disabled={blocks.length > 0}
          >
            {template ? 'Save template' : 'Create template'}
          </SubmitButton>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

export function ReplyTemplateEditor(props: ReplyTemplateEditorProps) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen} busy={props.action.isPending}>
      <DialogTrigger asChild>{props.trigger}</DialogTrigger>
      {open ? (
        <ReplyTemplateEditorBody {...props} onClose={() => setOpen(false)} />
      ) : null}
    </Dialog>
  )
}
