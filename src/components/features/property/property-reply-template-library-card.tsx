import { useState } from 'react'
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
import { SettingSwitchRow } from '#/components/forms/setting-switch-row'
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

/** One template's switch: it saves as it is flipped and says so while the request runs. */
function TemplateEnabledSwitch({
  propertyId,
  template,
  toggleAction,
}: Readonly<{
  propertyId: string
  template: PropertyReplyLibraryTemplate
  toggleAction: ToggleReplyTemplateAction
}>) {
  const [saving, setSaving] = useState(false)
  return (
    <SettingSwitchRow
      id={`reply-template-enabled-${template.id}`}
      layout="cell"
      label={`Enabled: ${template.title}`}
      stateWords={['On', 'Off']}
      commit="immediate"
      pending={saving}
      disabled={toggleAction.isPending}
      checked={template.enabled}
      onCheckedChange={(enabled) => {
        setSaving(true)
        // The action reports a refusal in a toast; this only ends the busy state.
        void toggleAction({ data: { propertyId, templateId: template.id, enabled } })
          .catch(() => undefined)
          .finally(() => setSaving(false))
      }}
    />
  )
}

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
        <CardTitle as="h2">Template library</CardTitle>
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
                    <TemplateEnabledSwitch
                      propertyId={propertyId}
                      template={template}
                      toggleAction={toggleAction}
                    />
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
