// PROTOTYPE — the placeholder layout the three variant files start from: the rail
// rows as a plain list beside the open section. A variant replaces it entirely.
import { SettingsPrototypeLink } from '../settings-prototype-nav'
import { SettingsPrototypeSection } from '../settings-prototype-sections'
import type { SettingsPrototypeContext } from '../settings-prototype-types'

export function SettingsPrototypeVariantStub({
  ctx,
  name,
}: Readonly<{ ctx: SettingsPrototypeContext; name: string }>) {
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-8 md:grid-cols-[16rem_minmax(0,1fr)]">
      <nav aria-label={`${name} settings sections`} className="space-y-4 text-sm">
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          Stub for variant {ctx.state.variant} ({name}). Replace this layout.
        </p>
        {ctx.rail.groups.map((group) => (
          <div key={group.key}>
            {group.label ? (
              <p className="px-3 pb-1 text-xs font-medium uppercase text-muted-foreground">
                {group.label}
              </p>
            ) : null}
            <ul className="space-y-0.5">
              {group.rows.map((row) => (
                <li key={row.key}>
                  <SettingsPrototypeLink
                    href={row.href}
                    current={row.key === ctx.current.key}
                    className="block rounded-md px-3 py-1.5 hover:bg-accent aria-[current=page]:bg-accent"
                  >
                    <span className="block">{row.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {row.statusText}
                    </span>
                  </SettingsPrototypeLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="min-w-0">
        <SettingsPrototypeSection ctx={ctx} />
      </div>
    </div>
  )
}
