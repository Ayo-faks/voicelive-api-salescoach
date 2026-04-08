/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react'
import ReactDOM from 'react-dom/client'
import { FluentProvider, webLightTheme } from '@fluentui/react-components'
import { BrowserRouter } from 'react-router-dom'
import App from './app/App'
import './styles/global.css'
import { initCookieConsent } from './cookieconsent-config'

const wuloTheme = {
  ...webLightTheme,
  fontFamilyBase: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontFamilyMonospace: "'IBM Plex Mono', 'JetBrains Mono', monospace",
  colorBrandBackground: '#0d8a84',
  colorBrandBackground2: 'rgba(13, 138, 132, 0.14)',
  colorBrandBackgroundHover: '#06625e',
  colorBrandForeground1: '#0f2a3a',
  colorBrandForeground2: '#0d8a84',
  colorBrandForegroundLink: '#0f2a3a',
  colorBrandForegroundLinkHover: '#06625e',
  colorBrandBackgroundPressed: '#06625e',
  colorCompoundBrandBackground: '#0d8a84',
  colorCompoundBrandBackgroundHover: '#06625e',
  colorCompoundBrandBackgroundPressed: '#06625e',
  colorCompoundBrandStroke: '#0d8a84',
  colorCompoundBrandStrokeHover: '#06625e',
  colorNeutralBackground1: 'rgba(250, 246, 239, 0.96)',
  colorNeutralBackground2: 'rgba(246, 239, 226, 0.96)',
  colorNeutralBackground3: '#fffaf2',
  colorNeutralStroke1: 'rgba(15, 42, 58, 0.12)',
  colorNeutralForeground1: '#0f2a3a',
  colorNeutralForeground2: '#2e3a3f',
  colorStatusWarningBackground1: 'rgba(255, 138, 128, 0.18)',
  colorStatusWarningForeground1: '#c85c55',
  borderRadiusMedium: '6px',
  borderRadiusLarge: '8px',
  borderRadiusXLarge: '10px',
}

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element not found')
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <FluentProvider theme={wuloTheme}>
        <App />
      </FluentProvider>
    </BrowserRouter>
  </React.StrictMode>
)

initCookieConsent()
