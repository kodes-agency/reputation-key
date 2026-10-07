// PROTOTYPE — delete after the decision. The page the /settings-prototype route
// renders: fixtures from the URL, the one context every variant draws from, the
// chosen variant, and the floating switcher.
import { useMemo } from 'react'
import { PrototypeSwitcher } from '#/components/prototype/prototype-switcher'
import {
  buildSettingsPrototypeData,
  type RealPropertyInput,
} from './settings-prototype-fixtures'
import { buildSettingsPrototypeContext } from './settings-prototype-model'
import {
  PROTOTYPE_PROPS,
  PROTOTYPE_ROLES,
  PROTOTYPE_VARIANTS,
  requestedSearchOf,
  type SettingsPrototypeSearch,
} from './settings-prototype-search'
import { SETTINGS_PROTOTYPE_VARIANTS } from './variants'

type Props = Readonly<{
  search: SettingsPrototypeSearch
  organizationName: string
  user: Readonly<{ name: string; email: string }>
  /** The live properties list; removed properties are left out here. */
  properties: ReadonlyArray<RealPropertyInput & Readonly<{ lifecycleState: string }>>
}>

const ROLE_LABEL = { aa: 'Admin', pm: 'Manager' } as const
const PROPS_LABEL = { '1': '1', '5': '5', '60': '60', real: 'real' } as const

export function SettingsPrototypePage({
  search,
  organizationName,
  user,
  properties,
}: Props) {
  const requested = useMemo(() => requestedSearchOf(search), [search])
  const realProperties = useMemo(
    () =>
      properties.filter(
        (p) => p.lifecycleState === 'active' || p.lifecycleState === 'suspended',
      ),
    [properties],
  )
  const viewer = useMemo(
    () => ({ name: user.name, email: user.email }),
    [user.name, user.email],
  )
  const data = useMemo(
    () =>
      buildSettingsPrototypeData({
        props: requested.props,
        role: requested.role,
        organizationName,
        user: viewer,
        realProperties,
      }),
    [requested.props, requested.role, organizationName, viewer, realProperties],
  )
  const ctx = useMemo(
    () => buildSettingsPrototypeContext({ search: requested, data }),
    [requested, data],
  )
  const { Component } = SETTINGS_PROTOTYPE_VARIANTS[ctx.state.variant]

  return (
    <>
      <Component ctx={ctx} />
      <PrototypeSwitcher
        variants={{
          current: ctx.state.variant,
          choices: PROTOTYPE_VARIANTS.map((key) => ({
            value: key,
            label: key,
            name: SETTINGS_PROTOTYPE_VARIANTS[key].name,
          })),
        }}
        toggles={[
          {
            param: 'props',
            label: 'Properties',
            current: ctx.state.props,
            choices: PROTOTYPE_PROPS.map((value) => ({
              value,
              label: PROPS_LABEL[value],
            })),
          },
          {
            param: 'role',
            label: 'Role',
            current: ctx.state.role,
            choices: PROTOTYPE_ROLES.map((value) => ({
              value,
              label: ROLE_LABEL[value],
            })),
          },
        ]}
      />
    </>
  )
}
