// What makes the parts of the previewed page selectable (board 02): the page
// stays an inert picture, and a layer of buttons sits over it, one on each part,
// where the page's own pixels are. The page is not made clickable (it holds
// real cards, forms and links of its own); a button over a part is a plain
// control the keyboard reaches, in the order the parts are on the page. The
// part of the section being edited is outlined and flagged with its name.
//
// The layer lives in the page's scaled, scrolling frame, so it moves with the
// page. Its lines and its flag are drawn against the scale, to stay as thick
// and as legible as the controls around the phone.

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { cn } from '#/lib/utils'
import { PORTAL_EDITOR_SECTION_ICONS } from '../portal-editor/portal-editor-section-icons'
import { PORTAL_EDITOR_SECTION_LABELS } from '../portal-editor/portal-editor-sections'
import { measurePartBoxes, sameBoxes, type PartBox } from './preview-part-boxes'
import { previewPartOf, type PreviewSelection } from './preview-parts'

/** The outline's width on screen, whatever the phone's scale. */
const LINE_WIDTH = 2
// Where things sit is geometry, not styling: it is set inline, with the numbers
// it is computed from, and the classes carry only colour and shape.
const FRAME_STYLE: CSSProperties = { position: 'relative', minHeight: '100%' }
const LAYER_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 10,
  pointerEvents: 'none',
}

/** What the flag needs above a part, on screen: a part nearer the top gets its flag below. */
const FLAG_ROOM = 28

type Props = Readonly<{
  scale: number
  selection: PreviewSelection
  /** The page, drawn inert. */
  children: ReactNode
}>

export function PreviewPartFrame({ scale, selection, children }: Props) {
  const frame = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const [boxes, setBoxes] = useState<readonly PartBox[]>([])

  const measure = useCallback(() => {
    if (frame.current === null || content.current === null) return
    const next = measurePartBoxes(content.current, frame.current)
    setBoxes((previous) => (sameBoxes(previous, next) ? previous : next))
  }, [])

  // The parts are where the page lays them out, so they are measured after it
  // is drawn (every time it is drawn anew) and when it changes size on its own,
  // as a font or a photo arrives.
  useLayoutEffect(measure)
  useLayoutEffect(() => {
    const drawn = content.current
    if (drawn === null) return
    const observer = new ResizeObserver(measure)
    observer.observe(drawn)
    return () => observer.disconnect()
  }, [measure])

  const active = previewPartOf(selection.active)
  return (
    <div ref={frame} style={FRAME_STYLE}>
      <div ref={content} inert>
        {children}
      </div>
      <div role="group" aria-label="Parts of the page you can edit" style={LAYER_STYLE}>
        {boxes.map(({ section, box }) => {
          const isActive = section === active
          const Icon = PORTAL_EDITOR_SECTION_ICONS[section]
          const label = PORTAL_EDITOR_SECTION_LABELS[section]
          const isNearTop = box.top * scale < FLAG_ROOM
          return (
            <button
              key={section}
              type="button"
              aria-label={`Edit ${label}`}
              aria-current={isActive ? 'true' : undefined}
              onClick={() => selection.onSelect(section)}
              className={cn(
                'cursor-pointer rounded-[28px] bg-transparent p-0',
                'transition-[outline-color] duration-150 focus-visible:outline-primary',
                isActive
                  ? 'outline-primary'
                  : 'outline-transparent hover:outline-primary/45',
              )}
              style={{
                position: 'absolute',
                pointerEvents: 'auto',
                top: box.top,
                left: box.left,
                width: box.width,
                height: box.height,
                outlineStyle: 'solid',
                outlineOffset: 0,
                outlineWidth: LINE_WIDTH / scale,
              }}
            >
              {isActive ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex items-center gap-1 bg-primary px-2 py-1 text-xs leading-none font-medium whitespace-nowrap text-primary-foreground',
                    isNearTop ? 'rounded-b-md' : 'rounded-t-md',
                  )}
                  style={{
                    position: 'absolute',
                    left: 0,
                    ...(isNearTop ? { top: '100%' } : { bottom: '100%' }),
                    transformOrigin: isNearTop ? 'top left' : 'bottom left',
                    transform: `scale(${1 / scale})`,
                    marginLeft: -(LINE_WIDTH / scale),
                  }}
                >
                  <Icon className="size-3" aria-hidden="true" />
                  {label}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
