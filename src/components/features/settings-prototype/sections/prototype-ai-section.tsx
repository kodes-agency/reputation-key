// PROTOTYPE — AI: the consent decision, the three tools and the workspace budget.
// Consent is AccountAdmin-only: a manager sees it locked with who to ask.
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
import { ConfirmationDialog } from '#/components/ui/confirmation-dialog'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { StatusBadge, type StatusMap } from '#/components/ui/status-badge'
import { SettingSwitchRow } from '#/components/forms/setting-switch-row'
import type { AiState } from '../settings-prototype-types'
import { LockedNotice, type SectionProps } from './prototype-section-kit'

export const AI_STATUS: StatusMap<AiState> = {
  on: { label: 'On', tone: 'positive' },
  off: { label: 'Off', tone: 'neutral' },
  undecided: { label: 'Not decided', tone: 'warn' },
}
const TOOLS = ['Draft replies', 'Summarize reviews', 'Spot topics'] as const
const FAKE_LATENCY_MS = 400

const later = () => new Promise<void>((resolve) => setTimeout(resolve, FAKE_LATENCY_MS))

export function AiSection({ ctx }: SectionProps) {
  const p = ctx.property
  const locked = ctx.shape.access.ai === 'lock'
  const [ai, setAi] = useState<AiState>(p?.ai ?? 'undecided')
  const [tools, setTools] = useState<Readonly<Record<string, boolean>>>(
    Object.fromEntries(
      TOOLS.map((tool, i) => [tool, i < (p?.aiTools ?? 0) || (p?.aiTools ?? 0) === 0]),
    ),
  )
  const budget = ctx.data.workspace.aiBudget
  return (
    <div className="space-y-5">
      {locked ? (
        <LockedNotice
          ctx={ctx}
          what="Whether AI may read this business's reviews is an account admin's decision."
        />
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle as="h3">
            AI for this {ctx.shape.showPropertySwitcher ? 'property' : 'business'}
          </CardTitle>
          <CardDescription>
            AI drafts a reply for a person to check. Nothing is posted without one.
          </CardDescription>
          <div className="justify-self-start">
            <StatusBadge status={ai} map={AI_STATUS} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {ai === 'undecided' ? (
            <Alert variant="warning">
              <AlertTitle>Decide about AI</AlertTitle>
              <AlertDescription>
                Turn it on to draft replies, or keep it off. You can change this any time.
              </AlertDescription>
            </Alert>
          ) : null}
          {ai === 'on'
            ? TOOLS.map((tool) => (
                <SettingSwitchRow
                  key={tool}
                  id={`ai-${tool}`}
                  label={tool}
                  checked={tools[tool] === true}
                  commit="immediate"
                  disabled={locked}
                  onCheckedChange={async (next) => {
                    await later()
                    setTools((previous) => ({ ...previous, [tool]: next }))
                  }}
                />
              ))
            : null}
        </CardContent>
        <CardFooter className="gap-2">
          {ai === 'on' ? (
            <ConfirmationDialog
              trigger={
                <Button variant="outline" disabled={locked}>
                  Turn off AI features
                </Button>
              }
              title="Turn off AI features?"
              description="Drafts stop appearing. Existing replies are not changed."
              cancelLabel="Keep AI on"
              confirmLabel="Turn off"
              onConfirm={() => setAi('off')}
            />
          ) : (
            <Button disabled={locked} onClick={() => setAi('on')}>
              Turn on AI
            </Button>
          )}
          {ai === 'undecided' ? (
            <Button variant="outline" disabled={locked} onClick={() => setAi('off')}>
              Keep AI off
            </Button>
          ) : null}
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle as="h3">Workspace AI budget</CardTitle>
          <CardDescription>{budget.label}</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            role="progressbar"
            aria-label="AI budget used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={budget.usedPercent}
            className="h-2 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${budget.usedPercent}%` }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
