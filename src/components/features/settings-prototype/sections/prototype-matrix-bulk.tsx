// PROTOTYPE — bulk apply for the many-properties matrix: four actions on the selected
// rows, each through the before -> after preview. Copy-type actions say they are
// applied once and the properties will not follow a default.
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { SelectRow } from './prototype-section-kit'
import { BulkPreviewDialog, type BulkChange } from './prototype-bulk-preview'
import type { PropertyFixture, SettingsPrototypeData } from '../settings-prototype-types'

const LANGUAGES = ['English', 'Bulgarian', 'German', 'Italian', 'French', 'Spanish']
const AI_CHOICES = ['On', 'Off'] as const
type Action = 'language' | 'manager' | 'ai' | 'reset'

const AI_LABEL = { on: 'On', off: 'Off', undecided: 'Not decided' } as const
const ONCE = 'Applied once. These properties will not follow a default.'

const TITLES: Readonly<Record<Action, string>> = {
  language: 'Set reply language',
  manager: 'Add a responsible manager',
  ai: 'Record an AI decision',
  reset: 'Reset targets to the default',
}

type Props = Readonly<{
  selected: readonly PropertyFixture[]
  data: SettingsPrototypeData
  onApplied: () => void
}>

export function MatrixBulkBar({ selected, data, onApplied }: Props) {
  const managers = data.members.filter((m) => m.role === 'PropertyManager')
  const [action, setAction] = useState<Action | null>(null)
  const [value, setValue] = useState('')
  const open = (next: Action, first: string) => {
    setValue(first)
    setAction(next)
  }

  const changes = (): readonly BulkChange[] =>
    selected.map((p) => {
      const base = { id: p.id, name: p.name }
      if (action === 'language')
        return { ...base, before: p.language ?? 'Not set', after: value }
      if (action === 'ai') return { ...base, before: AI_LABEL[p.ai], after: value }
      if (action === 'reset') {
        const before =
          p.targets.mode === 'custom'
            ? `Custom, ${p.targets.privateFeedbackHours} h`
            : 'Default'
        return { ...base, before, after: 'Default' }
      }
      const picked = managers.find((m) => m.name === value)
      const before = `${p.managerIds.length} managers`
      const adds = picked !== undefined && !p.managerIds.includes(picked.id)
      return {
        ...base,
        before,
        after: adds ? `${p.managerIds.length + 1} managers` : before,
      }
    })

  const options =
    action === 'language'
      ? LANGUAGES
      : action === 'ai'
        ? [...AI_CHOICES]
        : managers.map((m) => m.name)
  return (
    <>
      <div
        role="region"
        aria-label="Bulk actions"
        className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm"
      >
        <span className="mr-auto font-medium">{selected.length} selected</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => open('language', LANGUAGES[0] ?? '')}
        >
          Set language
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => open('manager', managers[0]?.name ?? '')}
        >
          Set manager
        </Button>
        <Button size="sm" variant="outline" onClick={() => open('ai', 'On')}>
          AI decision…
        </Button>
        <Button size="sm" variant="outline" onClick={() => open('reset', '')}>
          Reset
        </Button>
      </div>
      <BulkPreviewDialog
        open={action !== null}
        onOpenChange={(next) => (next ? undefined : setAction(null))}
        title={action === null ? '' : TITLES[action]}
        description={`Review what changes on ${selected.length} properties before it is applied.`}
        controls={
          action === null || action === 'reset' ? null : (
            <SelectRow
              id="bulk-value"
              label="Value"
              value={value}
              options={options}
              onChange={setValue}
            />
          )
        }
        changes={action === null ? [] : changes()}
        footnote={action === 'reset' ? undefined : ONCE}
        onApplied={onApplied}
      />
    </>
  )
}
