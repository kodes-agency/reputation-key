import { BookOpenText } from 'lucide-react'
import type { Action } from '#/components/hooks/use-action'
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
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '#/components/ui/data-table'
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
          <EmptyState
            icon={BookOpenText}
            title="No reply templates yet"
            description="Add a template for a rating band, review type, and language to make it available in the reply composer."
          />
        ) : (
          <DataTable label="Property reply template library" layout="scroll">
            <DataTableHeader>
              <DataTableHead>Title</DataTableHead>
              <DataTableHead>Rating band</DataTableHead>
              <DataTableHead>Review type</DataTableHead>
              <DataTableHead>Aspect</DataTableHead>
              <DataTableHead>Language</DataTableHead>
              <DataTableHead>Enabled</DataTableHead>
              <DataTableHead actions />
            </DataTableHeader>
            <DataTableBody>
              {templates.map((template) => (
                <DataTableRow key={template.id}>
                  <DataTableCell className="max-w-64 whitespace-normal font-medium">
                    {template.title}
                  </DataTableCell>
                  <DataTableCell>
                    {template.ratingMin === template.ratingMax
                      ? `${template.ratingMin} star${template.ratingMin === 1 ? '' : 's'}`
                      : `${template.ratingMin}–${template.ratingMax} stars`}
                  </DataTableCell>
                  <DataTableCell>
                    <Badge variant="outline">
                      {template.hasText ? 'With text' : 'Rating only'}
                    </Badge>
                  </DataTableCell>
                  <DataTableCell className="capitalize">
                    {template.aspect?.replaceAll('_', ' ') ?? 'General'}
                  </DataTableCell>
                  <DataTableCell>
                    <code>{template.languageTag}</code>
                  </DataTableCell>
                  <DataTableCell>
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
                  </DataTableCell>
                  <DataTableCell className="text-right">
                    <ReplyTemplateEditor
                      key={`${template.id}:${template.version}`}
                      propertyId={propertyId}
                      profile={profile}
                      template={template}
                      defaultLanguageTag={defaultLanguageTag}
                      action={saveAction}
                    />
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
        )}
      </CardContent>
    </Card>
  )
}
