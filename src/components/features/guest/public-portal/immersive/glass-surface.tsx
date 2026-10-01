import type { HTMLAttributes } from 'react'

/** The frosted-glass surfaces of the Immersive Hub, measured from the round-4 boards. */
export type GlassVariant = 'card' | 'tile' | 'chip'

/** The class list for a glass surface, for elements that are not a plain box (links, buttons). */
export function glassClassName(variant: GlassVariant, extra?: string): string {
  const base = `ih-glass ih-glass--${variant}`
  return extra ? `${base} ${extra}` : base
}

type GlassSurfaceProps = Readonly<{
  variant: GlassVariant
  as?: 'div' | 'section' | 'article'
}> &
  HTMLAttributes<HTMLElement>

/**
 * A frosted panel over the backdrop. Its fill, rim and blur come from the
 * shell's stylesheet, which also swaps in an opaque fill when the browser has
 * no `backdrop-filter`. Only meaningful inside `ImmersiveShell`.
 */
export function GlassSurface({
  variant,
  as: Tag = 'div',
  className,
  ...rest
}: GlassSurfaceProps) {
  return <Tag className={glassClassName(variant, className)} {...rest} />
}
