import type {
  GuestNetworkPressureConsumeInput,
  GuestNetworkPressureStore,
} from '../ports/guest-network-pressure.store.port'

export type ConsumeGuestNetworkPressureInput = Omit<
  GuestNetworkPressureConsumeInput,
  'observedAt'
>

export type ConsumeGuestNetworkPressureDeps = Readonly<{
  store: GuestNetworkPressureStore
  clock: () => Date
}>

export const consumeGuestNetworkPressure = (deps: ConsumeGuestNetworkPressureDeps) => {
  return (input: ConsumeGuestNetworkPressureInput) =>
    deps.store.consume({ ...input, observedAt: deps.clock() })
}

export type ConsumeGuestNetworkPressure = ReturnType<typeof consumeGuestNetworkPressure>
