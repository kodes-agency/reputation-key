import './instrument.client'
import { StrictMode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { StartClient } from '@tanstack/react-start/client'
import { startStaleTabGuard } from '#/shared/stale-tab/stale-tab'

// Before hydration: the page head still says which release this code came from.
startStaleTabGuard()

hydrateRoot(
  document,
  <StrictMode>
    <StartClient />
  </StrictMode>,
)
