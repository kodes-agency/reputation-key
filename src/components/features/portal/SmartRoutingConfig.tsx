import { cn } from '#/lib/utils'

type SmartRoutingConfigProps = Readonly<{
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
  threshold: number
  onThresholdChange: (threshold: number) => void
  disabled?: boolean
}>

export function SmartRoutingConfig({
  enabled,
  onEnabledChange,
  threshold,
  onThresholdChange,
  disabled = false,
}: SmartRoutingConfigProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border p-4">
        <div>
          <p className="font-medium">Smart Routing</p>
          <p className="text-sm text-muted-foreground">
            Emphasize feedback for low ratings, guide high raters to review sites.
          </p>
        </div>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          className="size-5 cursor-pointer rounded border"
          disabled={disabled}
        />
      </div>

      {enabled && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div
              className={cn(
                'rounded-lg border p-3 text-center text-sm',
                'border-amber-200 bg-amber-50',
              )}
            >
              <p className="font-medium text-amber-800">Below {threshold} stars</p>
              <p className="text-xs text-amber-600 mt-1">
                Guest sees feedback form prominently
              </p>
            </div>
            <div
              className={cn(
                'rounded-lg border p-3 text-center text-sm',
                'border-green-200 bg-green-50',
              )}
            >
              <p className="font-medium text-green-800">{threshold}+ stars</p>
              <p className="text-xs text-green-600 mt-1">
                Guest sees review site links prominently
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Rating threshold: {threshold}+ stars</p>
            <input
              type="range"
              min={1}
              max={4}
              value={threshold}
              onChange={(e) => onThresholdChange(Number(e.target.value))}
              className="w-full"
              disabled={disabled}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>1 star</span>
              <span>4 stars</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
