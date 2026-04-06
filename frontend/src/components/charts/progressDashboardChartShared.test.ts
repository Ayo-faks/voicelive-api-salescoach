import { describe, expect, it } from 'vitest'

import { getRadarChartData } from './progressDashboardChartShared'
import type { SessionDetail } from '../../types'

describe('getRadarChartData', () => {
  it('handles partial ai assessment payloads without throwing', () => {
    const session = {
      id: 'session-1',
      timestamp: '2026-04-06T10:00:00.000Z',
      child: { id: 'child-ayo', name: 'Ayo' },
      exercise: {
        id: 'exercise-1',
        name: 'R Sound Words',
        description: 'Practice /r/ words.',
      },
      assessment: {
        ai_assessment: {
          overall_score: 82,
        },
        pronunciation_assessment: {
          accuracy_score: 79,
          pronunciation_score: 80,
          fluency_score: 78,
        },
      },
    } as SessionDetail

    const data = getRadarChartData(session)

    expect(data).toHaveLength(6)
    expect(data[0]).toMatchObject({ subject: 'Target Sound Accuracy', score: 79 })
    expect(data[1]).toMatchObject({ subject: 'Overall Clarity', score: 80 })
  })
})
