/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useChildUiState } from './useChildUiState'
import { api } from '../services/api'
import { MASCOT_FLAG_KEY } from '../childOnboarding/childUiState'

const CHILD_ID = 'child-123'
const OUTBOX_KEY = `wulo.childUiStateOutbox:${CHILD_ID}`

describe('useChildUiState', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.spyOn(api, 'getChildUiState').mockResolvedValue({
      child_id: CHILD_ID,
      user_id: 'u',
      exercises: [],
    } as never)
    vi.spyOn(api, 'putChildUiState').mockResolvedValue(undefined as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is a complete no-op when disabled', async () => {
    const { result } = renderHook(() =>
      useChildUiState(CHILD_ID, { disabled: true }),
    )
    expect(result.current.loading).toBe(false)
    await act(async () => {
      await result.current.markMascotSeen()
    })
    expect(api.getChildUiState).not.toHaveBeenCalled()
    expect(api.putChildUiState).not.toHaveBeenCalled()
  })

  it('is a no-op when childId is null', async () => {
    const { result } = renderHook(() => useChildUiState(null))
    expect(result.current.loading).toBe(false)
    await act(async () => {
      await result.current.markMascotSeen()
    })
    expect(api.getChildUiState).not.toHaveBeenCalled()
    expect(api.putChildUiState).not.toHaveBeenCalled()
  })

  it('optimistically marks mascot seen and PUTs the reserved key', async () => {
    const { result } = renderHook(() => useChildUiState(CHILD_ID))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.markMascotSeen()
    })
    expect(result.current.state.mascot_seen).toBe(true)
    expect(api.putChildUiState).toHaveBeenCalledWith(CHILD_ID, {
      exercise_type: MASCOT_FLAG_KEY,
      first_run: true,
    })
  })

  it('rolls back on a 4xx (non-401) and reports the error', async () => {
    ;(api.putChildUiState as unknown as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockRejectedValue(new Error('422 invalid'))
    const { result } = renderHook(() => useChildUiState(CHILD_ID))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.markTutorialSeen('silent_sorting')
    })
    expect(result.current.state.exercise_tutorials_seen).toBeUndefined()
    expect(result.current.error).toBeInstanceOf(Error)
  })

  it('queues to the outbox on 5xx and preserves the optimistic view', async () => {
    ;(api.putChildUiState as unknown as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockRejectedValue(new Error('503 upstream down'))
    const { result } = renderHook(() => useChildUiState(CHILD_ID))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.markTutorialSeen('silent_sorting')
    })
    expect(result.current.state.exercise_tutorials_seen).toEqual({
      silent_sorting: true,
    })
    const queued = JSON.parse(window.localStorage.getItem(OUTBOX_KEY) ?? '[]')
    expect(queued).toEqual([
      { exercise_type: 'silent_sorting', first_run: true },
    ])
  })

  it('replays the outbox on mount', async () => {
    window.localStorage.setItem(
      OUTBOX_KEY,
      JSON.stringify([
        { exercise_type: 'silent_sorting', first_run: true },
      ]),
    )
    const putSpy = api.putChildUiState as unknown as ReturnType<typeof vi.fn>
    renderHook(() => useChildUiState(CHILD_ID))
    await waitFor(() => {
      expect(putSpy).toHaveBeenCalledWith(CHILD_ID, {
        exercise_type: 'silent_sorting',
        first_run: true,
      })
    })
    await waitFor(() => {
      expect(window.localStorage.getItem(OUTBOX_KEY)).toBeNull()
    })
  })

  it('stops writing on 401 without retrying', async () => {
    ;(api.putChildUiState as unknown as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockRejectedValue(new Error('401 unauthorized'))
    const { result } = renderHook(() => useChildUiState(CHILD_ID))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.markMascotSeen()
    })
    // Optimistic rollback.
    expect(result.current.state.mascot_seen).toBeUndefined()
    // Subsequent writes are ignored while unauthenticated.
    ;(api.putChildUiState as unknown as ReturnType<typeof vi.fn>).mockClear()
    await act(async () => {
      await result.current.markWrapUpSeen()
    })
    expect(api.putChildUiState).not.toHaveBeenCalled()
  })
})
