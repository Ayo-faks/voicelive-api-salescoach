import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useDisclosureState } from './useDisclosureState'

describe('useDisclosureState', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    window.localStorage.clear()
  })

  it('returns the default when no value is stored', () => {
    const { result } = renderHook(() =>
      useDisclosureState('user-1', 'career', false)
    )
    expect(result.current[0]).toBe(false)

    const { result: openByDefault } = renderHook(() =>
      useDisclosureState('user-1', 'parent', true)
    )
    expect(openByDefault.current[0]).toBe(true)
  })

  it('persists state per user/section under the documented key', () => {
    const { result } = renderHook(() =>
      useDisclosureState('user-1', 'career', false)
    )
    act(() => result.current[1](true))
    expect(result.current[0]).toBe(true)
    expect(
      window.localStorage.getItem('pathfinder-disclosure:user-1:career')
    ).toBe('1')

    act(() => result.current[1](false))
    expect(
      window.localStorage.getItem('pathfinder-disclosure:user-1:career')
    ).toBe('0')
  })

  it('isolates state between users', () => {
    const { result: a } = renderHook(() =>
      useDisclosureState('user-a', 'parent', false)
    )
    act(() => a.current[1](true))

    const { result: b } = renderHook(() =>
      useDisclosureState('user-b', 'parent', false)
    )
    expect(b.current[0]).toBe(false)
  })

  it('rehydrates from existing localStorage on mount', () => {
    window.localStorage.setItem('pathfinder-disclosure:user-1:trust', '1')
    const { result } = renderHook(() =>
      useDisclosureState('user-1', 'trust', false)
    )
    expect(result.current[0]).toBe(true)
  })
})
