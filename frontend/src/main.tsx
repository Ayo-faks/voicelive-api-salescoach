/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react'
import ReactDOM from 'react-dom/client'
import { FluentProvider } from '@fluentui/react-components'
import { BrowserRouter, useLocation } from 'react-router-dom'
import App from './app/App'
import PathfinderLearnApp from './learning/PathfinderLearnApp'
import './styles/global.css'
import { wuloTheme } from './theme/wuloTheme'

// Paths owned by the legacy SalesCoach / voice-agent surface (App.tsx).
// Everything else falls through to the Pathfinder Learn shell.
const LEGACY_PATH_PREFIXES = [
  '/session',
  '/dashboard',
  '/settings',
  '/mode',
  '/onboarding',
  '/login',
  '/logout',
  '/privacy',
  '/terms',
  '/ai-transparency',
]

function RootSwitch() {
  const { pathname } = useLocation()
  const isLegacy = LEGACY_PATH_PREFIXES.some(
    p => pathname === p || pathname.startsWith(p + '/'),
  )
  return isLegacy ? <App /> : <PathfinderLearnApp />
}

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element not found')
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <FluentProvider theme={wuloTheme}>
      <BrowserRouter>
        <RootSwitch />
      </BrowserRouter>
    </FluentProvider>
  </React.StrictMode>
)
