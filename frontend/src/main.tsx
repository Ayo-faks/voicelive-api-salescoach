/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react'
import ReactDOM from 'react-dom/client'
import { FluentProvider } from '@fluentui/react-components'
import { BrowserRouter } from 'react-router-dom'
import PathfinderLearnApp from './learning/PathfinderLearnApp'
import './styles/global.css'
import { initCookieConsent } from './cookieconsent-config'
import { wuloTheme } from './theme/wuloTheme'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element not found')
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <FluentProvider theme={wuloTheme}>
      <BrowserRouter>
        <PathfinderLearnApp />
      </BrowserRouter>
    </FluentProvider>
  </React.StrictMode>
)

initCookieConsent()
