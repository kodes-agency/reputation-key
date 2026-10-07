// PROTOTYPE — Look & brand, moved here from Portals. A few brand fields, a small
// preview, and the way back to the portals the person came from.
import { useState } from 'react'
import { InlineLink } from '#/components/ui/inline-link'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import type { LookState } from '../settings-prototype-types'
import { SaveRow, SelectRow, TextRow, type SectionProps } from './prototype-section-kit'
import { usePrototypeForm } from './use-prototype-form'

const ACCENTS: Readonly<Record<string, string>> = {
  Accent: 'bg-primary text-primary-foreground',
  Ink: 'bg-foreground text-background',
  Quiet: 'bg-muted text-foreground',
}

export function LookSection({ ctx }: SectionProps) {
  const p = ctx.property
  const [look, setLook] = useState<LookState>(p?.look ?? 'none')
  const form = usePrototypeForm({
    brandName: p?.name ?? '',
    tagline: 'Tell us how it was',
    accent: 'Accent',
  })
  return (
    <div className="space-y-5">
      <p className="text-sm">
        <InlineLink to="/portals">Back to portals</InlineLink>
      </p>
      {look === 'draft' ? (
        <Alert variant="info">
          <AlertTitle>Draft changes</AlertTitle>
          <AlertDescription>
            Your look is edited but not live. Guests still see the published one.
          </AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle as="h3">Brand</CardTitle>
          <CardDescription>Every portal of this business wears it.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <TextRow
            id="look-name"
            label="Brand name"
            value={form.value.brandName}
            onChange={(brandName) => form.set({ brandName })}
          />
          <TextRow
            id="look-tagline"
            label="Tagline"
            optional
            value={form.value.tagline}
            onChange={(tagline) => form.set({ tagline })}
          />
          <SelectRow
            id="look-accent"
            label="Accent"
            value={form.value.accent}
            options={Object.keys(ACCENTS)}
            onChange={(accent) => form.set({ accent })}
          />
          <div className="rounded-xl border bg-background p-5 text-center">
            <p className="text-xs text-muted-foreground">Preview</p>
            <p className="mt-1 text-lg font-semibold">{form.value.brandName}</p>
            <p className="text-sm text-muted-foreground">{form.value.tagline}</p>
            <span
              className={`mt-3 inline-flex rounded-md px-3 py-1.5 text-sm font-medium ${ACCENTS[form.value.accent] ?? ''}`}
            >
              Leave a review
            </span>
          </div>
        </CardContent>
        <CardFooter>
          <SaveRow form={form} />
        </CardFooter>
      </Card>
      {look !== 'published' ? (
        <Card>
          <CardHeader>
            <CardTitle as="h3">Publish</CardTitle>
            <CardDescription>Make this look live on every portal.</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button onClick={() => setLook('published')}>Publish look</Button>
          </CardFooter>
        </Card>
      ) : null}
    </div>
  )
}
