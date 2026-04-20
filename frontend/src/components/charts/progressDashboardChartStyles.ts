/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const progressDashboardChartStyleSlots = {
  summaryChartCard: {
    gridColumn: 'span 1',
    '@media (max-width: 1080px)': {
      gridColumn: 'span 1',
    },
    '@media (max-width: 640px)': {
      gridColumn: 'span 1',
    },
  },
  chartHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 'var(--space-md)',
    flexWrap: 'wrap',
  },
  chartLegend: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
    marginTop: '4px',
  },
  legendItem: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    color: 'var(--color-text-secondary)',
    fontSize: '0.74rem',
    fontWeight: '600',
  },
  legendSwatch: {
    width: '10px',
    height: '10px',
    display: 'inline-block',
    border: '1px solid rgba(15, 42, 58, 0.08)',
  },
  chartArea: {
    width: '100%',
    minHeight: '188px',
    padding: '10px',
    border: '1px solid rgba(15, 42, 58, 0.12)',
    backgroundColor: 'rgba(255, 253, 249, 0.88)',
  },
  compactChartArea: {
    width: '100%',
    minHeight: '136px',
    padding: '8px 10px',
    border: '1px solid rgba(15, 42, 58, 0.12)',
    backgroundColor: 'rgba(255, 253, 249, 0.88)',
  },
  calendarWrap: {
    overflowX: 'auto',
    padding: '8px 10px 6px',
    border: '1px solid rgba(15, 42, 58, 0.12)',
    backgroundColor: 'rgba(255, 253, 249, 0.88)',
    marginBottom: 'var(--space-sm)',
  },
  radarLayout: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: 'var(--space-md)',
    alignItems: 'center',
  },
  radarMetaGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 'var(--space-sm)',
    '@media (max-width: 640px)': {
      gridTemplateColumns: '1fr',
    },
  },
  statTile: {
    border: '1px solid rgba(15, 42, 58, 0.12)',
    backgroundColor: 'rgba(255, 253, 249, 0.98)',
    padding: '12px',
    display: 'grid',
    gap: '4px',
  },
  wordHeatmapGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
    gap: '10px',
  },
  visualSplit: {
    display: 'grid',
    gridTemplateColumns: '120px minmax(0, 1fr)',
    gap: 'var(--space-md)',
    alignItems: 'center',
    '@media (max-width: 640px)': {
      gridTemplateColumns: '1fr',
    },
  },
  planSummaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 188px',
    gap: 'var(--space-md)',
    alignItems: 'start',
    '@media (max-width: 640px)': {
      gridTemplateColumns: '1fr',
    },
  },
  progressRail: {
    position: 'relative',
    width: '100%',
  },
  progressAverageMarker: {
    position: 'absolute',
    top: '-2px',
    bottom: '-2px',
    width: '2px',
    backgroundColor: 'var(--color-accent-strong)',
    pointerEvents: 'none',
  },
  progressAverageDot: {
    position: 'absolute',
    top: '-4px',
    left: '-3px',
    width: '8px',
    height: '8px',
    backgroundColor: 'var(--color-accent-strong)',
    border: '1px solid rgba(255, 255, 255, 0.9)',
    borderRadius: '9999px',
  },
  progressMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 'var(--space-sm)',
    marginTop: '6px',
    color: 'var(--color-text-secondary)',
    fontSize: '0.72rem',
  },
} as const