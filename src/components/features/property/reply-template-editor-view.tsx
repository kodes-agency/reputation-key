import type { Dispatch, RefObject, SetStateAction } from 'react'
import { FormFieldFrame } from '#/components/forms/form-field-frame'
import { FormTextField } from '#/components/forms/form-text-field'
import { Button } from '#/components/ui/button'
import { SegmentedControl } from '#/components/ui/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Textarea } from '#/components/ui/textarea'
import { REVIEW_TOPICS_V3, REVIEW_TOPIC_LABELS_V3 } from '#/shared/review-topic-taxonomy'
import type {
  EditorFinding,
  EditorLanguage,
  EditorWording,
  ReplyTemplateEditorForm,
} from './reply-template-editor-form'
import { ReplyTemplateEditorFindings as Findings } from './reply-template-editor-findings'

type Props = Readonly<{
  form: ReplyTemplateEditorForm
  wordings: EditorWording[]
  language: EditorLanguage
  setLanguage: Dispatch<SetStateAction<EditorLanguage>>
  selected: number
  setSelected: Dispatch<SetStateAction<number>>
  bodyRef: RefObject<HTMLTextAreaElement | null>
  insertVariable: (value: string) => void
  blocks: EditorFinding[]
  warnings: EditorFinding[]
  preview: string
  submissionAttempts: number
}>

// fallow-ignore-next-line complexity -- presentational branches keep validation, scope, and language fields in one dialog form
export function ReplyTemplateEditorView(props: Props) {
  const { form, wordings, language, selected, setSelected } = props
  const current = wordings[selected] ?? wordings[0] ?? null
  if (!current) return null
  const bodyIndex = form.state.values.wordings.findIndex(
    (wording) => wording.key === current.key && wording.languageGroup === language,
  )
  const bodyName = `wordings[${bodyIndex}].body` as `wordings[${number}].body`
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="flex min-w-0 flex-col gap-4">
        <form.Field name="title">
          {(field) => (
            <FormTextField
              field={field}
              id="template-title"
              label="Title"
              maxLength={120}
            />
          )}
        </form.Field>
        <div className="grid grid-cols-2 gap-4">
          <form.Field name="starsMin">
            {(field) => (
              <FormFieldFrame
                id="template-stars-from"
                label="Stars from"
                invalid={field.state.meta.isTouched && !field.state.meta.isValid}
                errors={field.state.meta.errors}
              >
                <StarSelect
                  id="template-stars-from"
                  value={field.state.value}
                  onChange={field.handleChange}
                />
              </FormFieldFrame>
            )}
          </form.Field>
          <form.Field name="starsMax">
            {(field) => (
              <FormFieldFrame
                id="template-stars-to"
                label="Stars to"
                invalid={field.state.meta.isTouched && !field.state.meta.isValid}
                errors={field.state.meta.errors}
              >
                <StarSelect
                  id="template-stars-to"
                  value={field.state.value}
                  onChange={field.handleChange}
                />
              </FormFieldFrame>
            )}
          </form.Field>
        </div>
        <form.Field name="reviewKind">
          {(field) => (
            <FormFieldFrame
              id="template-review-type"
              label="Review type"
              invalid={field.state.meta.isTouched && !field.state.meta.isValid}
              errors={field.state.meta.errors}
            >
              <SegmentedControl
                aria-label="Review type"
                value={field.state.value}
                options={[
                  { value: 'text', label: 'With text' },
                  { value: 'rating_only', label: 'Star-only' },
                ]}
                onValueChange={(value) =>
                  field.handleChange(value as 'text' | 'rating_only')
                }
                touch
              />
            </FormFieldFrame>
          )}
        </form.Field>
        <form.Field name="topic">
          {(field) => (
            <FormFieldFrame
              id="template-topic"
              label="Topic"
              invalid={field.state.meta.isTouched && !field.state.meta.isValid}
              errors={field.state.meta.errors}
            >
              <Select
                value={field.state.value ?? 'general'}
                onValueChange={(value) =>
                  field.handleChange(
                    value === 'general'
                      ? null
                      : (value as (typeof REVIEW_TOPICS_V3)[number]),
                  )
                }
              >
                <SelectTrigger id="template-topic">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">General</SelectItem>
                  {REVIEW_TOPICS_V3.map((value) => (
                    <SelectItem key={value} value={value}>
                      {REVIEW_TOPIC_LABELS_V3[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormFieldFrame>
          )}
        </form.Field>
        <div className="flex items-center justify-between gap-3">
          <p className="font-medium">Wordings</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              const key = crypto.randomUUID()
              form.setFieldValue('wordings', [
                ...form.state.values.wordings,
                { key, languageGroup: 'en-Latn', body: '' },
                { key, languageGroup: 'es-Latn', body: '' },
              ])
              setSelected(wordings.length)
            }}
          >
            Add wording
          </Button>
        </div>
        <SegmentedControl
          aria-label="Selected wording"
          value={String(selected)}
          options={wordings.map((_, index) => ({
            value: String(index),
            label: `Wording ${index + 1}`,
          }))}
          onValueChange={(value) => setSelected(Number(value))}
        />
        <SegmentedControl
          aria-label="Wording language"
          value={language}
          options={[
            { value: 'en-Latn', label: 'English' },
            { value: 'es-Latn', label: 'Español' },
          ]}
          onValueChange={(value) => props.setLanguage(value as EditorLanguage)}
          touch
        />
        <form.Field name={bodyName}>
          {(field) => {
            const noStoredWording = form.state.values.wordings.every(
              (wording) => wording.body.trim().length === 0,
            )
            const required = props.submissionAttempts > 0 && noStoredWording
            const invalid = field.state.meta.errors.length > 0 || required
            const errors = required
              ? [{ message: 'Template body is required' }]
              : field.state.meta.errors
            return (
              <FormFieldFrame
                id="template-body"
                label="Reply body"
                invalid={invalid}
                errors={invalid ? errors : undefined}
              >
                <Textarea
                  ref={props.bodyRef}
                  id="template-body"
                  value={field.state.value}
                  rows={7}
                  maxLength={4096}
                  aria-invalid={invalid}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </FormFieldFrame>
            )
          }}
        </form.Field>
        <div className="flex flex-wrap gap-2">
          <VariableButton value="{visit_word}" insert={props.insertVariable} />
          {form.state.values.starsMin >= 4 ? (
            <VariableButton value="{staff_name}" insert={props.insertVariable} />
          ) : null}
          {language === 'en-Latn' ? (
            <VariableButton value="{thing}" insert={props.insertVariable} />
          ) : null}
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={wordings.length === 1}
            onClick={() => {
              form.setFieldValue(
                'wordings',
                form.state.values.wordings.filter(
                  (wording) => wording.key !== current.key,
                ),
              )
              setSelected(0)
            }}
          >
            Remove wording
          </Button>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <div>
          <p className="mb-2 font-medium">Checks</p>
          {props.blocks.length === 0 && props.warnings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No issues found.</p>
          ) : null}
          <div className="flex flex-col gap-2">
            <Findings findings={props.blocks} variant="destructive" />
            <Findings findings={props.warnings} variant="warning" />
          </div>
        </div>
        <div>
          <p className="mb-2 font-medium">Preview</p>
          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {props.preview || 'Start writing to preview this reply.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function StarSelect({
  id,
  value,
  onChange,
}: Readonly<{ id: string; value: number; onChange: (value: number) => void }>) {
  return (
    <Select value={String(value)} onValueChange={(next) => onChange(Number(next))}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {[1, 2, 3, 4, 5].map((star) => (
          <SelectItem key={star} value={String(star)}>
            {star}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function VariableButton({
  value,
  insert,
}: Readonly<{ value: string; insert: (value: string) => void }>) {
  return (
    <Button type="button" size="xs" variant="outline" onClick={() => insert(value)}>
      {value}
    </Button>
  )
}
