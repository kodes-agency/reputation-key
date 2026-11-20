import { Alert, AlertDescription } from '#/components/ui/alert'
import type { EditorFinding } from './reply-template-editor-form'

export function ReplyTemplateEditorFindings({
  findings,
  variant,
}: Readonly<{ findings: EditorFinding[]; variant: 'destructive' | 'warning' }>) {
  return findings.map((finding, index) => (
    <Alert key={`${finding.code}-${index}`} variant={variant}>
      <AlertDescription>
        {finding.language}: {finding.message}
      </AlertDescription>
    </Alert>
  ))
}
