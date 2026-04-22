/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { VisualizationBlock } from './VisualizationBlock'

vi.mock('recharts', async importOriginal => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => (
      <div data-testid="responsive-container" style={{ width: 640, height: 240 }}>
        {children}
      </div>
    ),
  }
})

describe('VisualizationBlock', () => {
  it('renders a line chart spec with title and caption', () => {
    render(
      <VisualizationBlock
        spec={{
          kind: 'line',
          title: 'Weekly overall score',
          caption: 'Latest 4 sessions',
          x_label: 'Session',
          y_label: 'Score',
          series: [
            {
              name: 'Overall',
              points: [
                { x: '2026-03-01', y: 62 },
                { x: '2026-03-08', y: 74 },
              ],
            },
          ],
        }}
      />,
    )

    const block = screen.getByTestId('visualization-block')
    expect(block.getAttribute('data-kind')).toBe('line')
    expect(screen.getByText('Weekly overall score')).toBeTruthy()
    expect(screen.getByText('Latest 4 sessions')).toBeTruthy()
    expect(screen.getByTestId('visualization-chart')).toBeTruthy()
  })

  it('renders a bar chart spec', () => {
    render(
      <VisualizationBlock
        spec={{
          kind: 'bar',
          title: 'Focus sound accuracy',
          series: [
            {
              name: 'Accuracy',
              points: [
                { x: 'k', y: 58 },
                { x: 't', y: 72 },
              ],
            },
          ],
        }}
      />,
    )

    const block = screen.getByTestId('visualization-block')
    expect(block.getAttribute('data-kind')).toBe('bar')
    expect(screen.getByTestId('visualization-chart')).toBeTruthy()
  })

  it('renders a table spec with headers, rows, and blank-cell fallback', () => {
    render(
      <VisualizationBlock
        spec={{
          kind: 'table',
          title: 'Recent sessions',
          columns: [
            { key: 'date', label: 'Date' },
            { key: 'overall', label: 'Overall' },
            { key: 'note', label: 'Note' },
          ],
          rows: [
            { date: '2026-03-15', overall: 81, note: 'Carryover gains' },
            { date: '2026-03-08', overall: 74, note: null },
          ],
        }}
      />,
    )

    const block = screen.getByTestId('visualization-block')
    expect(block.getAttribute('data-kind')).toBe('table')
    const table = screen.getByTestId('visualization-table') as HTMLTableElement
    const headerCells = Array.from(table.querySelectorAll('thead th')).map(cell => cell.textContent)
    expect(headerCells).toEqual(['Date', 'Overall', 'Note'])

    const bodyRows = Array.from(table.querySelectorAll('tbody tr'))
    expect(bodyRows).toHaveLength(2)
    const firstRowCells = Array.from(bodyRows[0].querySelectorAll('td')).map(cell => cell.textContent)
    expect(firstRowCells).toEqual(['2026-03-15', '81', 'Carryover gains'])
    const secondRowCells = Array.from(bodyRows[1].querySelectorAll('td')).map(cell => cell.textContent)
    expect(secondRowCells).toEqual(['2026-03-08', '74', '—'])
  })

  it('renders the fallback for an unknown kind', () => {
    render(<VisualizationBlock spec={{ kind: 'scatter', title: 'Nope' }} />)
    expect(screen.queryByTestId('visualization-block')).toBeNull()
    expect(
      screen.getByText('Visualization unavailable — the data did not match the expected format.'),
    ).toBeTruthy()
  })

  it('renders the fallback when the spec is not an object', () => {
    render(<VisualizationBlock spec={'oops' as unknown as object} />)
    expect(
      screen.getByText('Visualization unavailable — the data did not match the expected format.'),
    ).toBeTruthy()
  })

  it('renders the fallback when a series has a non-finite y value', () => {
    render(
      <VisualizationBlock
        spec={{
          kind: 'line',
          title: 'Bad',
          series: [
            {
              name: 's',
              points: [{ x: 1, y: Number.NaN }],
            },
          ],
        }}
      />,
    )
    expect(screen.queryByTestId('visualization-chart')).toBeNull()
    expect(
      screen.getByText('Visualization unavailable — the data did not match the expected format.'),
    ).toBeTruthy()
  })

  it('drops unknown cell keys from table rows', () => {
    render(
      <VisualizationBlock
        spec={{
          kind: 'table',
          title: 'Leak test',
          columns: [{ key: 'a', label: 'A' }],
          rows: [{ a: 'ok', secret: 'leak' }],
        }}
      />,
    )
    expect(screen.queryByText('leak')).toBeNull()
    expect(screen.getByText('ok')).toBeTruthy()
  })
})
