import { Loader2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog'
import { Button } from '#/components/ui/button'
import { CardFooter } from '#/components/ui/card'

export function MerchantAiSettingsActions({
  propertyName,
  canRevoke,
  isEnabled,
  canEnable,
  canSave,
  passwordPresent,
  pending,
  onEnable,
  onChange,
  onRevoke,
}: Readonly<{
  propertyName: string
  canRevoke: boolean
  isEnabled: boolean
  canEnable: boolean
  canSave: boolean
  passwordPresent: boolean
  pending: boolean
  onEnable: () => void
  onChange: () => void
  onRevoke: () => void
}>) {
  return (
    <CardFooter className="flex-col gap-3 border-t sm:flex-row sm:justify-end">
      {canRevoke ? (
        <>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                className="min-h-11 w-full sm:w-auto"
                disabled={!passwordPresent || pending}
              >
                Turn off AI features
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Turn off AI features for {propertyName}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Future review analysis, reply drafting, and property trend processing
                  will stop for this property. This does not disconnect Google.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep AI features on</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={onRevoke}>
                  Turn off
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {isEnabled ? (
            <Button
              className="min-h-11 w-full sm:w-auto"
              disabled={!canSave}
              onClick={onChange}
            >
              {pending ? (
                <Loader2
                  data-icon="inline-start"
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : null}
              Save feature access
            </Button>
          ) : null}
        </>
      ) : (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button className="min-h-11 w-full sm:w-auto" disabled={!canEnable}>
              Enable AI features
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Enable all AI features for {propertyName}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                You confirm the data-handling notice above and authorize review analysis,
                editable reply drafting, and de-identified property trends for this
                property.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onEnable}>Confirm and enable</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </CardFooter>
  )
}
