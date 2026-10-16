// The rating ruler under the goal (E2/E4, R3-11): a tick a tenth from four
// below today to 5.0, taller at whole stars, today's number as a fixed mark,
// and the climb to the goal as a segment with the goal's dot at its end. It is
// decoration (`aria-hidden`): the numeral and its sentence carry the goal. The
// segment and the dot move by transform only, and stop moving for reduced
// motion. Positions and the mock's one-off sizes are inline styles.
import { rulerGeometry } from './rating-goal-setup-copy'
import { tenthsText } from './rating-goal-view'

const MOVE = 'transition-transform duration-500 ease-out motion-reduce:transition-none'
const LABEL = 'absolute font-mono text-xs whitespace-nowrap text-muted-foreground'

const percent = (fraction: number): string => `${fraction * 100}%`

export function RatingGoalRatingRuler({
  shownTenths,
  targetTenths,
  small,
}: Readonly<{ shownTenths: number; targetTenths: number; small: boolean }>) {
  const ruler = rulerGeometry(shownTenths, targetTenths)
  return (
    <div
      aria-hidden="true"
      className="relative w-full"
      // The goal's dot rides a full-width layer moved by transform: clip it
      // sideways so it never widens the screen.
      style={{ maxWidth: small ? 300 : 520, height: small ? 56 : 58, overflowX: 'clip' }}
    >
      <div
        className="absolute inset-x-0 rounded-full bg-border"
        style={{ top: 30, height: 2 }}
      />
      {ruler.ticks.map((tick) => (
        <span
          key={tick.at}
          className="absolute bg-muted-foreground/50"
          style={{
            left: percent(tick.at),
            top: 26,
            width: 1,
            height: tick.whole ? 10 : 6,
          }}
        />
      ))}
      <div
        className={`absolute origin-left rounded-full bg-primary ${MOVE}`}
        style={{
          left: percent(ruler.today),
          right: 0,
          top: 29,
          height: 4,
          transform: `scaleX(${ruler.climb})`,
        }}
      />
      <span
        className="absolute rounded-full bg-muted-foreground"
        style={{
          left: percent(ruler.today),
          top: 22,
          width: 3,
          height: 18,
          marginLeft: -1.5,
        }}
      />
      <div
        className={`absolute inset-x-0 ${MOVE}`}
        style={{ top: 25, transform: `translateX(${percent(ruler.goal)})` }}
      >
        <span
          className="block rounded-full bg-primary"
          style={{
            width: 12,
            height: 12,
            marginLeft: -6,
            boxShadow: '0 0 0 3px var(--background)',
          }}
        />
      </div>
      <span
        className={LABEL}
        style={{ left: percent(ruler.today), top: 44, transform: 'translateX(-50%)' }}
      >
        today {tenthsText(shownTenths)}
      </span>
      <span className={LABEL} style={{ right: 0, top: 44 }}>
        5.0
      </span>
    </div>
  )
}
