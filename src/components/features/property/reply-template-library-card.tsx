import { useState } from 'react'
import type { Action } from '#/components/hooks/use-action'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { AddAction } from '#/components/ui/add-action'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'
import { ConfirmationDialog } from '#/components/ui/confirmation-dialog'
import { RowActionsItem, RowActionsMenu } from '#/components/ui/row-actions-menu'
import { StatusBadge, type StatusMap } from '#/components/ui/status-badge'
import type {
  ReplyLibraryDto,
  ReplyLibraryTemplateDto,
  ResetReplyTemplateInput,
  SaveReplyTemplateInput,
  SetReplyTemplateHiddenInput,
} from '#/contexts/review/application/dto/reply-library.dto'
import { REVIEW_TOPIC_LABELS_V3 } from '#/shared/review-topic-taxonomy'
import { ReplyTemplateEditor, templateActionScope } from './reply-template-editor'

type SaveAction = Action<{ data: SaveReplyTemplateInput }, ReplyLibraryDto>
type HideAction = Action<{ data: SetReplyTemplateHiddenInput }, ReplyLibraryDto>
type ResetAction = Action<{ data: ResetReplyTemplateInput }, ReplyLibraryDto>
type CardProps = Readonly<{
  propertyId: string
  propertyName: string
  propertyCount: number
  library: ReplyLibraryDto
  saveAction: SaveAction
  hideAction: HideAction
  resetAction: ResetAction
}>

const TEMPLATE_STATUS: StatusMap<ReplyLibraryTemplateDto['status']> = {
  builtin: { label: 'Built-in', tone: 'neutral' },
  customized: { label: 'Customized', tone: 'warn' },
  yours: { label: 'Yours', tone: 'positive' },
  hidden: { label: 'Hidden', tone: 'neutral' },
}

function stars(template: Pick<ReplyLibraryTemplateDto, 'starsMin' | 'starsMax'>) {
  return template.starsMin === template.starsMax
    ? `${template.starsMin}★`
    : `${template.starsMin}-${template.starsMax}★`
}

function groupFor(template: ReplyLibraryTemplateDto) {
  if (template.ref.startsWith('builtin:S-')) return 'Special cases'
  if (template.starsMin >= 4) return 'Positive with text'
  if (template.starsMax <= 2) return 'Negative with text'
  return 'Mixed'
}

function TemplateRow({
  template,
  ...props
}: CardProps & { template: ReplyLibraryTemplateDto }) {
  const scope = templateActionScope(template, props.propertyCount)
  const [menuOpen, setMenuOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const changeVisibility = async () => {
    await props.hideAction({
      data: {
        propertyId: props.propertyId,
        scope,
        ref: template.ref,
        hidden: template.status !== 'hidden',
      },
    })
    setMenuOpen(false)
  }
  return (
    <li
      className={
        template.status === 'hidden'
          ? 'flex flex-col gap-3 border-b py-4 opacity-60 sm:flex-row sm:items-center'
          : 'flex flex-col gap-3 border-b py-4 sm:flex-row sm:items-center'
      }
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium">{template.title}</p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{stars(template)}</span>
          <span>·</span>
          <span>{template.reviewKind === 'text' ? 'With text' : 'Star-only'}</span>
          <span>·</span>
          <span>
            {template.topic ? REVIEW_TOPIC_LABELS_V3[template.topic] : 'General'}
          </span>
          <StatusBadge status={template.status} map={TEMPLATE_STATUS} />
        </p>
      </div>
      {props.library.canManage ? (
        <div className="flex flex-wrap gap-2">
          <ReplyTemplateEditor
            propertyId={props.propertyId}
            propertyName={props.propertyName}
            propertyCount={props.propertyCount}
            library={props.library}
            template={template}
            action={props.saveAction}
            trigger={
              <Button type="button" size="sm" variant="outline">
                Edit
              </Button>
            }
          />
          <RowActionsMenu
            name={template.title}
            open={menuOpen}
            onOpenChange={setMenuOpen}
          >
            <RowActionsItem
              pending={props.hideAction.isPending}
              pendingLabel={template.status === 'hidden' ? 'Showing…' : 'Hiding…'}
              onSelect={(event) => {
                event.preventDefault()
                void changeVisibility().catch(() => undefined)
              }}
            >
              {template.status === 'hidden' ? 'Show' : 'Hide'}
            </RowActionsItem>
            {template.status === 'customized' ? (
              <RowActionsItem destructive opensDialog onSelect={() => setResetOpen(true)}>
                Reset
              </RowActionsItem>
            ) : null}
          </RowActionsMenu>
          {template.status === 'customized' ? (
            <ConfirmationDialog
              open={resetOpen}
              onOpenChange={setResetOpen}
              title="Reset this template?"
              description="Your customized wording will be removed and the built-in restored."
              cancelLabel="Keep customized"
              confirmLabel="Reset template"
              pendingLabel="Resetting…"
              tone="destructive"
              onConfirm={() =>
                props.resetAction({
                  data: { propertyId: props.propertyId, scope, ref: template.ref },
                })
              }
            />
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

export function ReplyTemplateLibraryCard(props: CardProps) {
  const essentials = props.library.templates.filter(
    (template) => template.essential && template.ref.startsWith('builtin:'),
  )
  const more = props.library.templates.filter(
    (template) => !template.essential && template.ref.startsWith('builtin:'),
  )
  const yours = props.library.templates.filter((template) =>
    template.ref.startsWith('template:'),
  )
  const groups = [
    'Positive with text',
    'Mixed',
    'Negative with text',
    'Special cases',
  ] as const
  const row = (template: ReplyLibraryTemplateDto) => (
    <TemplateRow key={template.ref} {...props} template={template} />
  )
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Templates</CardTitle>
        <CardDescription>
          Choose which reply bodies are available in the Inbox and customize their
          wordings.
        </CardDescription>
        {props.library.canManage ? (
          <CardAction>
            <ReplyTemplateEditor
              propertyId={props.propertyId}
              propertyName={props.propertyName}
              propertyCount={props.propertyCount}
              library={props.library}
              template={null}
              action={props.saveAction}
              trigger={<AddAction>Add template</AddAction>}
            />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <section aria-labelledby="reply-essentials">
          <p id="reply-essentials" className="font-medium">
            Essentials
          </p>
          <ul>{essentials.map(row)}</ul>
        </section>
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="outline">
              More templates
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-5 flex flex-col gap-5">
            {groups.map((group) => {
              const templates = more.filter((template) => groupFor(template) === group)
              return templates.length ? (
                <section key={group} aria-label={group}>
                  <p className="font-medium">{group}</p>
                  <ul>{templates.map(row)}</ul>
                </section>
              ) : null
            })}
          </CollapsibleContent>
        </Collapsible>
        {yours.length ? (
          <section aria-labelledby="reply-yours">
            <p id="reply-yours" className="font-medium">
              Your templates
            </p>
            <ul>{yours.map(row)}</ul>
          </section>
        ) : null}
        {!props.library.canManage ? (
          <Alert variant="info">
            <AlertDescription>Templates are read-only for your role.</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  )
}
