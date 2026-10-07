// PROTOTYPE — Response targets. At one property: plain values (Save writes the
// workspace default and clears any override, which needs an ADR in the real build).
// At 2+: follow the default or go custom, and "Followed by n of m". In the
// all-properties scope: the default editor, with a previewed reset of the custom ones.
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Label } from '#/components/ui/label'
import { RadioGroup, RadioGroupItem } from '#/components/ui/radio-group'
import { DescriptionItem, DescriptionList } from '#/components/ui/description-list'
import { Badge } from '#/components/ui/badge'
import { hrefOf } from '../settings-prototype-model'
import { SettingsPrototypeLink } from '../settings-prototype-nav'
import { BulkPreviewDialog } from './prototype-bulk-preview'
import {
  LockedNotice,
  SaveRow,
  TextRow,
  type SectionProps,
} from './prototype-section-kit'
import { usePrototypeForm } from './use-prototype-form'

const hours = (value: string): string => `${value} h`

export function TargetsSection({ ctx }: SectionProps) {
  const p = ctx.property
  if (p === null) return null
  const locked = ctx.shape.access.targets === 'lock'
  const { defaults } = ctx.data.workspace
  const single = ctx.shape.tier === 'single'
  const followers = ctx.data.allProperties.filter(
    (x) => x.targets.mode === 'default',
  ).length
  return (
    <TargetsCard
      key={p.id}
      ctx={ctx}
      single={single}
      locked={locked}
      followers={followers}
      defaults={defaults}
    />
  )
}

function TargetsCard({
  ctx,
  single,
  locked,
  followers,
  defaults,
}: Readonly<{
  ctx: SectionProps['ctx']
  single: boolean
  locked: boolean
  followers: number
  defaults: Readonly<{ privateFeedbackHours: number; googleReviewsHours: number }>
}>) {
  const p = ctx.property
  const form = usePrototypeForm({
    mode: p?.targets.mode ?? 'default',
    privateFeedback: String(
      p?.targets.privateFeedbackHours ?? defaults.privateFeedbackHours,
    ),
    googleReviews: String(p?.targets.googleReviewsHours ?? defaults.googleReviewsHours),
  })
  const custom = form.value.mode === 'custom'
  const total = ctx.data.allProperties.length
  return (
    <div className="space-y-5">
      {locked ? (
        <LockedNotice ctx={ctx} what="Response targets are set by the workspace." />
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle as="h3">Private feedback</CardTitle>
          <CardDescription>
            {single
              ? 'How quickly your team aims to handle new feedback and Google reviews.'
              : 'How quickly this property aims to handle private feedback.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {single ? null : (
            <RadioGroup
              value={form.value.mode}
              onValueChange={(mode) =>
                form.set({ mode: mode === 'custom' ? 'custom' : 'default' })
              }
              disabled={locked}
              aria-label="Private feedback target"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="default" id="targets-default" />
                <Label htmlFor="targets-default">
                  Follow the default ({hours(String(defaults.privateFeedbackHours))})
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="custom" id="targets-custom" />
                <Label htmlFor="targets-custom">Custom for this property</Label>
              </div>
            </RadioGroup>
          )}
          <TextRow
            id="targets-private"
            label="Handling target, hours"
            type="number"
            value={form.value.privateFeedback}
            disabled={locked || (!single && !custom)}
            onChange={(privateFeedback) => form.set({ privateFeedback })}
          />
          {single ? (
            <TextRow
              id="targets-google"
              label="Google review target, hours"
              type="number"
              value={form.value.googleReviews}
              disabled={locked}
              onChange={(googleReviews) => form.set({ googleReviews })}
            />
          ) : (
            <DescriptionList>
              <DescriptionItem term="Google reviews">
                {hours(String(defaults.googleReviewsHours))}. Same for every property.{' '}
                {ctx.shape.showAllProperties ? (
                  <SettingsPrototypeLink
                    href={hrefOf(ctx.shape, 'default-targets', 'all', null)}
                    className="font-medium text-link hover:underline"
                  >
                    Edit the default
                  </SettingsPrototypeLink>
                ) : null}
              </DescriptionItem>
            </DescriptionList>
          )}
          {single ? null : (
            <p className="text-sm text-muted-foreground">
              Default is followed by {followers} of {total} properties.
            </p>
          )}
        </CardContent>
        <CardFooter>
          <SaveRow form={form} disabled={locked} />
        </CardFooter>
      </Card>
    </div>
  )
}

/** All properties > Response targets: the default editor, and who follows it. */
export function DefaultTargetsSection({ ctx }: SectionProps) {
  const { defaults } = ctx.data.workspace
  const form = usePrototypeForm({
    privateFeedback: String(defaults.privateFeedbackHours),
    googleReviews: String(defaults.googleReviewsHours),
  })
  const [resetOpen, setResetOpen] = useState(false)
  const all = ctx.data.properties
  const custom = all.filter((p) => p.targets.mode === 'custom')
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle as="h3">Default targets</CardTitle>
          <CardDescription>
            Followed by {all.length - custom.length} of {all.length} properties. A
            property can have its own.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <TextRow
            id="default-private"
            label="Private feedback, hours"
            type="number"
            value={form.value.privateFeedback}
            onChange={(privateFeedback) => form.set({ privateFeedback })}
          />
          <TextRow
            id="default-google"
            label="Google reviews, hours"
            type="number"
            value={form.value.googleReviews}
            onChange={(googleReviews) => form.set({ googleReviews })}
          />
        </CardContent>
        <CardFooter>
          <SaveRow form={form} />
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle as="h3">
            Properties with their own target ({custom.length})
          </CardTitle>
          <CardDescription>These do not follow the default.</CardDescription>
        </CardHeader>
        <CardContent>
          {custom.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Every property follows the default.
            </p>
          ) : (
            <ul className="max-h-64 divide-y overflow-auto rounded-lg border text-sm">
              {custom.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <SettingsPrototypeLink
                    href={hrefOf(ctx.shape, 'targets', 'property', p.id)}
                    className="font-medium text-link hover:underline"
                  >
                    {p.name}
                  </SettingsPrototypeLink>
                  <Badge variant="neutral">
                    Custom, {p.targets.privateFeedbackHours} h
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
        {custom.length > 0 ? (
          <CardFooter>
            <Button variant="outline" onClick={() => setResetOpen(true)}>
              Reset {custom.length} to the default…
            </Button>
          </CardFooter>
        ) : null}
      </Card>
      <BulkPreviewDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="Reset to the default?"
        description="These properties will follow the default again."
        changes={custom.map((p) => ({
          id: p.id,
          name: p.name,
          before: `Custom, ${p.targets.privateFeedbackHours} h`,
          after: `Default, ${form.value.privateFeedback} h`,
        }))}
      />
    </div>
  )
}
