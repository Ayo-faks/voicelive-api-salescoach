/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react'
import ReactDOM from 'react-dom/client'
import { FluentProvider, webLightTheme } from '@fluentui/react-components'
import App from './app/App'
import './styles/global.css'

const wuloTheme = {
  ...webLightTheme,
  fontFamilyBase: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontFamilyMonospace: "'IBM Plex Mono', 'JetBrains Mono', monospace",
  colorBrandBackground: '#0d8a84',
  colorBrandBackground2: 'rgba(13, 138, 132, 0.12)',
  colorBrandBackgroundHover: '#06625e',
  colorBrandForeground1: '#06625e',
  colorBrandForeground2: '#0d8a84',
  colorBrandForegroundLink: '#06625e',
  colorBrandForegroundLinkHover: '#0d8a84',
  colorBrandBackgroundPressed: '#06625e',
  colorCompoundBrandBackground: '#0d8a84',
  colorCompoundBrandBackgroundHover: '#06625e',
  colorCompoundBrandBackgroundPressed: '#06625e',
  colorCompoundBrandStroke: '#0d8a84',
  colorCompoundBrandStrokeHover: '#06625e',
  colorNeutralBackground1: 'rgba(255, 255, 255, 0.88)',
  colorNeutralBackground2: 'rgba(240, 245, 247, 0.85)',
  colorNeutralBackground3: '#f4f7f8',
  colorNeutralStroke1: 'rgba(17, 36, 58, 0.12)',
  colorNeutralForeground1: '#11243a',
  colorNeutralForeground2: '#456076',
  colorStatusWarningBackground1: 'rgba(212, 143, 75, 0.14)',
  colorStatusWarningForeground1: '#b97a35',
  borderRadiusMedium: '14px',
  borderRadiusLarge: '20px',
  borderRadiusXLarge: '28px',
}

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element not found')
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <FluentProvider theme={wuloTheme}>
      <App />
    </FluentProvider>
  </React.StrictMode>
)
