import { BookOpenText } from 'lucide-react'
import type { Action } from '#/components/hooks/use-action'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { Badge } from '#/components/ui/badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { EmptyState } from '#/components/ui/empty-state'
import { Switch } from '#/components/ui/switch'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import type { SetPropertyReplyTemplateEnabledInput } from '#/contexts/review/application/dto/reply-library.dto'
import type {
  PropertyReplyLibraryProfile,
  PropertyReplyLibraryTemplate,
} from '#/contexts/review/application/use-cases/reply-library-operations'
import { usePermissions } from '#/shared/hooks/usePermissions'
import {
  ReplyTemplateEditor,
  type SaveReplyTemplateAction,
} from './reply-template-editor'

type ToggleReplyTemplateAction = Action<{
  data: SetPropertyReplyTemplateEnabledInput
}>

type Props = Readonly<{
  propertyId: string
  profile: PropertyReplyLibraryProfile | null
  templates: readonly PropertyReplyLibraryTemplate[]
  defaultLanguageTag: string | null
  saveAction: SaveReplyTemplateAction
  toggleAction: ToggleReplyTemplateAction
}>

export function PropertyReplyTemplateLibraryCard({
  propertyId,
  profile,
  templates,
  defaultLanguageTag,
  saveAction,
  toggleAction,
}: Props) {
  const { can } = usePermissions()
  const canManage = can('reply.manage')

  return (
    <Card>
      <CardHeader>
        <CardTitle>Template library</CardTitle>
        <CardDescription>
          Author Property-specific replies by rating, review type, aspect, and language.
          Disable a template to remove it from the composer without deleting its history.
        </CardDescription>
        {canManage ? (
          <CardAction>
            <ReplyTemplateEditor
              propertyId={propertyId}
              profile={profile}
              template={null}
              defaultLanguageTag={defaultLanguageTag}
              action={saveAction}
            />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!canManage ? (
          <p className="text-sm text-muted-foreground">
            Ask a property manager or account admin to manage this template library.
          </p>
        ) : templates.length === 0 ? (
          <EmptyState icon={BookOpenText} title="No reply templates yet">
            <p className="max-w-md text-sm text-muted-foreground">
              Add a template for a rating band, review type, and language to make it
              available in the reply composer.
            </p>
          </EmptyState>
        ) : (
          <Table>
            <TableCaption className="sr-only">
              Property reply template library
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Rating band</TableHead>
                <TableHead>Review type</TableHead>
                <TableHead>Aspect</TableHead>
                <TableHead>Language</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((template) => (
                <TableRow key={template.id}>
                  <TableCell className="max-w-64 whitespace-normal font-medium">
                    {template.title}
                  </TableCell>
                  <TableCell>
                    {template.ratingMin === template.ratingMax
                      ? `${template.ratingMin} star${template.ratingMin === 1 ? '' : 's'}`
                      : `${template.ratingMin}–${template.ratingMax} stars`}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {template.hasText ? 'With text' : 'Rating only'}
                    </Badge>
                  </TableCell>
                  <TableCell className="capitalize">
                    {template.aspect?.replaceAll('_', ' ') ?? 'General'}
                  </TableCell>
                  <TableCell>
                    <code>{template.languageTag}</code>
                  </TableCell>
                  <TableCell>
                    <label
                      htmlFor={`reply-template-enabled-${template.id}`}
                      className="flex min-h-11 cursor-pointer items-center gap-2"
                    >
                      <Switch
                        id={`reply-template-enabled-${template.id}`}
                        checked={template.enabled}
                        onCheckedChange={(enabled) =>
                          void toggleAction({
                            data: { propertyId, templateId: template.id, enabled },
                          })
                        }
                        disabled={toggleAction.isPending}
                        aria-label={`${template.enabled ? 'Disable' : 'Enable'} ${template.title}`}
                      />
                      <span className="text-sm text-muted-foreground">
                        {template.enabled ? 'On' : 'Off'}
                      </span>
                    </label>
                  </TableCell>
                  <TableCell className="text-right">
                    <ReplyTemplateEditor
                      key={`${template.id}:${template.version}`}
                      propertyId={propertyId}
                      profile={profile}
                      template={template}
                      defaultLanguageTag={defaultLanguageTag}
                      action={saveAction}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <FormErrorBanner error={toggleAction.error} />
      </CardContent>
    </Card>
  )
}
