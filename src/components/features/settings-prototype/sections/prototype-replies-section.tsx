// PROTOTYPE — Replies: the richest Business page (language, voice, templates).
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Textarea } from '#/components/ui/textarea'
import { FormFieldFrame } from '#/components/forms/form-field-frame'
import type { PropertyFixture } from '../settings-prototype-types'
import { SaveRow, SelectRow, TextRow, type SectionProps } from './prototype-section-kit'
import { usePrototypeForm } from './use-prototype-form'

const LANGUAGES = ['English', 'Bulgarian', 'German', 'Italian', 'French', 'Spanish']
const TONES = ['Warm', 'Professional', 'Playful']
const TEMPLATES: ReadonlyArray<Readonly<{ name: string; when: string }>> = [
  { name: 'Thank you for five stars', when: '5 stars' },
  { name: 'Thanks, and what to improve', when: '4 stars' },
  { name: 'Sorry, let us make it right', when: '1 to 3 stars' },
  { name: 'Reply to a review with no text', when: 'No text' },
]

export function RepliesSection({ ctx }: SectionProps) {
  const p = ctx.property
  if (p === null) return null
  return (
    <div className="space-y-5">
      <LanguageCard property={p} />
      <VoiceCard property={p} />
      <TemplatesCard />
    </div>
  )
}

function LanguageCard({ property: p }: Readonly<{ property: PropertyFixture }>) {
  const form = usePrototypeForm({ language: p.language ?? '' })
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h3">Language</CardTitle>
        <CardDescription>The language replies are written in.</CardDescription>
      </CardHeader>
      <CardContent>
        <SelectRow
          id="replies-language"
          label="Reply language"
          value={form.value.language}
          options={LANGUAGES}
          onChange={(language) => form.set({ language })}
        />
      </CardContent>
      <CardFooter>
        <SaveRow form={form} />
      </CardFooter>
    </Card>
  )
}

function VoiceCard({ property: p }: Readonly<{ property: PropertyFixture }>) {
  const form = usePrototypeForm({
    greeting: p.voice?.greeting ?? '',
    signOff: p.voice?.signOff ?? '',
    tone: 'Warm',
    notes: '',
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h3">Voice</CardTitle>
        <CardDescription>How a reply starts, ends and sounds.</CardDescription>
        {p.voice === null ? (
          <Badge variant="warn" className="justify-self-start">
            Needed
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-5">
        <TextRow
          id="replies-greeting"
          label="Greeting"
          value={form.value.greeting}
          onChange={(greeting) => form.set({ greeting })}
          description="{first name} is replaced by the guest's first name."
        />
        <TextRow
          id="replies-sign-off"
          label="Sign-off"
          value={form.value.signOff}
          onChange={(signOff) => form.set({ signOff })}
        />
        <SelectRow
          id="replies-tone"
          label="Tone"
          value={form.value.tone}
          options={TONES}
          onChange={(tone) => form.set({ tone })}
        />
        <FormFieldFrame
          id="replies-notes"
          label="Things to always or never say"
          optional
          invalid={false}
        >
          <Textarea
            id="replies-notes"
            rows={3}
            value={form.value.notes}
            onChange={(event) => form.set({ notes: event.target.value })}
          />
        </FormFieldFrame>
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          {form.value.greeting || 'Dear guest,'} Thank you for staying with us. We hope to
          see you again. {form.value.signOff || 'Warm regards'}
        </p>
      </CardContent>
      <CardFooter>
        <SaveRow form={form} label="Save voice" />
      </CardFooter>
    </Card>
  )
}

function TemplatesCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h3">Templates ({TEMPLATES.length})</CardTitle>
        <CardDescription>
          Starting points for the replies you write most often.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y rounded-lg border">
          {TEMPLATES.map((template) => (
            <li
              key={template.name}
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <span className="min-w-0 flex-1">{template.name}</span>
              <Badge variant="neutral">{template.when}</Badge>
              <Button variant="ghost" size="sm">
                Edit
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter>
        <Button variant="outline">Add template</Button>
      </CardFooter>
    </Card>
  )
}
