// PROTOTYPE — Danger zone and "Add another location": the two rows in the rail's footer.
// Add another location explains the step from one property to two, which is the
// moment Settings grows a switcher and a default.
import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import {
  ConfirmationDialog,
  ConfirmationTrigger,
} from '#/components/ui/confirmation-dialog'
import type { SectionProps } from './prototype-section-kit'

const nothing = () => undefined

export function DangerSection({ ctx }: SectionProps) {
  const noun = ctx.shape.tier === 'single' ? 'business' : 'property'
  const canRemove = ctx.shape.role === 'aa' && ctx.property !== null
  return (
    <div className="space-y-5">
      {canRemove ? (
        <Card>
          <CardHeader>
            <CardTitle as="h3">Remove this {noun}</CardTitle>
            <CardDescription>
              {ctx.property?.name} is held for 30 days and can be restored from
              Properties.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <ConfirmationDialog
              trigger={
                <ConfirmationTrigger tone="destructive">
                  Remove {noun}…
                </ConfirmationTrigger>
              }
              title={`Remove ${ctx.property?.name ?? noun}?`}
              description="Reviews stop syncing and its portals go offline. Nothing is deleted for 30 days."
              cancelLabel="Keep it"
              confirmLabel="Remove"
              tone="destructive"
              onConfirm={nothing}
            />
          </CardFooter>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle as="h3">Leave this workspace</CardTitle>
          <CardDescription>
            Your access ends immediately. Hand over what you are responsible for first.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <ConfirmationDialog
            trigger={
              <ConfirmationTrigger tone="destructive">
                Leave workspace…
              </ConfirmationTrigger>
            }
            title="Leave this workspace?"
            description="You will be signed out of every device."
            cancelLabel="Stay"
            confirmLabel="Leave"
            tone="destructive"
            onConfirm={nothing}
          />
        </CardFooter>
      </Card>
    </div>
  )
}

export function AddLocationSection({ ctx }: SectionProps) {
  const single = ctx.shape.tier === 'single'
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h3">Add another location</CardTitle>
        <CardDescription>
          Locations come from Google. Pick the listing to import.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {single ? (
          <>
            <p>
              Adding a second location changes what Settings shows, and nothing you have
              set up moves:
            </p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>A location switcher appears above the sections.</li>
              <li>
                Response targets become a default that each location follows or overrides.
              </li>
              <li>
                An All properties view lists every location and what still needs setting
                up.
              </li>
            </ul>
          </>
        ) : (
          <p className="text-muted-foreground">
            The new location starts on the default targets and finishes setup from its own
            page.
          </p>
        )}
      </CardContent>
      <CardFooter>
        <Button asChild>
          <Link to="/properties/import-google">Import from Google</Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
