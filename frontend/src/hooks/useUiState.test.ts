/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Regression tests for the `loading` semantics of `useUiState`.
 *
 * These specifically guard against the stale-false window that used to
 * exist when `loading` was stored via `useState<boolean>(!disabled)`.
 * During the render where `disabled` flips from true → false (auth
 * resolving after a `window.location.assign(...)` in
 * `requestReplayTour`), the old implementation reported `loading=false`
 * for one render, which allowed the `onboardingGatePending` guard in
 * `App.tsx` to bounce `/dashboard → /onboarding` before the ui-state
 * fetch had a chance to return `onboarding_complete=true`. See
 * `memories/repo/voicelive-api-salescoach.md`.
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useUiState } from './useUiState'
import { api } from '../services/api'

describe('useUiState loading semantics', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports loading=true synchronously on first render when enabled+authenticated', () => {
    let resolveFetch: (v: Record<string, unknown>) => void = () => {}
    vi.spyOn(api, 'getUiState').mockImplementation(
      () => new Promise(resolve => { resolveFetch = resolve }),
    )

    const { result } = renderHook(() =>
      useUiState({ disabled: false, authenticated: true }),
    )

    // Before the effect's fetch has a chance to resolve, the hook must
    // already be reporting `loading=true` — otherwise callers like the
    // route guard in App.tsx will see stale-false.
    expect(result.current.loading).toBe(true)

    act(() => {
      resolveFetch({ onboarding_complete: true })
    })
  })

  it('flips loading=false after the initial fetch resolves', async () => {
    vi.spyOn(api, 'getUiState').mockResolvedValue({
      onboarding_complete: true,
      tours_seen: ['welcome-therapist'],
    })

    const { result } = renderHook(() =>
      useUiState({ disabled: false, authenticated: true }),
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.state).toEqual({
      onboarding_complete: true,
      tours_seen: ['welcome-therapist'],
    })
  })

  it('stays at loading=false immediately when disabled', () => {
    const spy = vi.spyOn(api, 'getUiState').mockResolvedValue({})

    const { result } = renderHook(() => useUiState({ disabled: true }))

    expect(result.current.loading).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })

  it('stays at loading=false when not yet authenticated', () => {
    const spy = vi.spyOn(api, 'getUiState').mockResolvedValue({})

    const { result } = renderHook(() =>
      useUiState({ disabled: false, authenticated: false }),
    )

    expect(result.current.loading).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })

  it('flips loading=true synchronously when auth resolves on a later render', async () => {
    let resolveFetch: (v: Record<string, unknown>) => void = () => {}
    vi.spyOn(api, 'getUiState').mockImplementation(
      () => new Promise(resolve => { resolveFetch = resolve }),
    )

    const { result, rerender } = renderHook(
      ({ disabled, authenticated }: { disabled: boolean; authenticated: boolean }) =>
        useUiState({ disabled, authenticated }),
      { initialProps: { disabled: true, authenticated: false } },
    )

    expect(result.current.loading).toBe(false)

    // Mirror the real-world transition: auth becomes 'authenticated',
    // which simultaneously flips `disabled` false and `authenticated`
    // true. The hook MUST report `loading=true` on this render — before
    // any `useEffect` has had a chance to commit — so that downstream
    // guards stay pending.
    rerender({ disabled: false, authenticated: true })
    expect(result.current.loading).toBe(true)

    await act(async () => {
      resolveFetch({ onboarding_complete: true })
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
  })

  it('re-enters loading=true during an explicit refresh()', async () => {
    const getSpy = vi
      .spyOn(api, 'getUiState')
      .mockResolvedValueOnce({ onboarding_complete: true })

    const { result } = renderHook(() =>
      useUiState({ disabled: false, authenticated: true }),
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    let resolveSecond: (v: Record<string, unknown>) => void = () => {}
    getSpy.mockImplementationOnce(
      () => new Promise(resolve => { resolveSecond = resolve }),
    )

    act(() => {
      void result.current.refresh()
    })
    await waitFor(() => expect(result.current.loading).toBe(true))

    await act(async () => {
      resolveSecond({ onboarding_complete: true, tours_seen: ['welcome-therapist'] })
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.state.tours_seen).toEqual(['welcome-therapist'])
  })
})
