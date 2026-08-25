import type { ReactNode } from 'react'
import { Checkbox } from '#/components/ui/checkbox'
import type { GoalSubject } from '#/contexts/goal/application/public-api'

export type GoalSubjectKey =
  `property:${string}` | `portal_group:${string}` | `portal:${string}`

export function goalSubjectKey(subject: GoalSubject): GoalSubjectKey {
  if (subject.kind === 'property') return `property:${subject.propertyId}`
  if (subject.kind === 'portal_group') return `portal_group:${subject.portalGroupId}`
  return `portal:${subject.portalId}`
}

export function goalSubjectsFromKeys(keys: readonly GoalSubjectKey[]): GoalSubject[] {
  return keys.map((key) => {
    const [kind, id] = key.split(':') as [GoalSubject['kind'], string]
    if (kind === 'property') return { kind, propertyId: id }
    if (kind === 'portal_group') return { kind, portalGroupId: id }
    return { kind, portalId: id }
  })
}

type GoalSubjectPickerProps = Readonly<{
  property: Readonly<{ id: string; name: string }>
  groups: readonly Readonly<{
    id: string
    name: string
    portalIds: readonly string[]
  }>[]
  portals: readonly Readonly<{ id: string; name: string }>[]
  selected: readonly GoalSubjectKey[]
  onChange: (selected: GoalSubjectKey[]) => void
}>

export function GoalSubjectPicker({
  property,
  groups,
  portals,
  selected,
  onChange,
}: GoalSubjectPickerProps) {
  const selectedSet = new Set(selected)
  const toggle = (key: GoalSubjectKey, checked: boolean) => {
    onChange(
      checked
        ? [...new Set([...selected, key])]
        : selected.filter((item) => item !== key),
    )
  }
  const propertyKey: GoalSubjectKey = `property:${property.id}`

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Select at least one. Standalone portals do not need to belong to a group.
      </p>
      <SubjectOption
        id="goal-subject-property"
        label={property.name}
        detail="Property"
        checked={selectedSet.has(propertyKey)}
        onChange={(checked) => toggle(propertyKey, checked)}
      />
      {groups.length > 0 ? (
        <SubjectSection title="Portal groups">
          {groups.map((group) => {
            const key: GoalSubjectKey = `portal_group:${group.id}`
            return (
              <SubjectOption
                key={key}
                id={`goal-subject-${group.id}`}
                label={group.name}
                detail={`${group.portalIds.length} ${group.portalIds.length === 1 ? 'portal' : 'portals'}`}
                checked={selectedSet.has(key)}
                onChange={(checked) => toggle(key, checked)}
              />
            )
          })}
        </SubjectSection>
      ) : null}
      <SubjectSection title="Portals">
        {portals.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No portals are available for this property.
          </p>
        ) : (
          portals.map((portal) => {
            const key: GoalSubjectKey = `portal:${portal.id}`
            return (
              <SubjectOption
                key={key}
                id={`goal-subject-${portal.id}`}
                label={portal.name}
                detail="Portal"
                checked={selectedSet.has(key)}
                onChange={(checked) => toggle(key, checked)}
              />
            )
          })
        )}
      </SubjectSection>
    </div>
  )
}

function SubjectSection({
  title,
  children,
}: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">{title}</h2>
      <div className="space-y-1">{children}</div>
    </section>
  )
}

function SubjectOption({
  id,
  label,
  detail,
  checked,
  onChange,
}: Readonly<{
  id: string
  label: string
  detail: string
  checked: boolean
  onChange: (checked: boolean) => void
}>) {
  return (
    <label
      htmlFor={id}
      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-accent"
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <span className="min-w-0 flex-1 text-sm">
        <span className="block truncate font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
    </label>
  )
}
