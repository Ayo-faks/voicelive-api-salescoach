/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MIC_MODE_STORAGE_KEY,
  readStoredMicMode,
  writeStoredMicMode,
} from './micMode'

function makeMemoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    data,
  }
}

describe('micMode utils', () => {
  const originalEnvValue = import.meta.env.VITE_CONVERSATIONAL_MIC_ENABLED

  beforeEach(() => {
    vi.stubEnv('VITE_CONVERSATIONAL_MIC_ENABLED', 'true')
  })

  afterEach(() => {
    if (originalEnvValue === undefined) {
      vi.unstubAllEnvs()
    } else {
      vi.stubEnv('VITE_CONVERSATIONAL_MIC_ENABLED', String(originalEnvValue))
    }
  })

  it('returns "tap" when the feature flag is disabled, regardless of storage', () => {
    vi.stubEnv('VITE_CONVERSATIONAL_MIC_ENABLED', 'false')
    const storage = makeMemoryStorage()
    storage.setItem(MIC_MODE_STORAGE_KEY, 'conversational')

    expect(readStoredMicMode(undefined, storage)).toBe('tap')
  })

  it('returns the stored mode when valid and flag enabled', () => {
    const storage = makeMemoryStorage()
    storage.setItem(MIC_MODE_STORAGE_KEY, 'tap')

    expect(readStoredMicMode(undefined, storage)).toBe('tap')
  })

  it('defaults to "conversational" when flag is enabled and storage is empty', () => {
    const storage = makeMemoryStorage()

    expect(readStoredMicMode(undefined, storage)).toBe('conversational')
  })

  it('ignores invalid values in storage', () => {
    const storage = makeMemoryStorage()
    storage.setItem(MIC_MODE_STORAGE_KEY, 'garbage')

    expect(readStoredMicMode(undefined, storage)).toBe('conversational')
  })

  it('honors an explicit override', () => {
    const storage = makeMemoryStorage()
    storage.setItem(MIC_MODE_STORAGE_KEY, 'conversational')

    expect(readStoredMicMode('tap', storage)).toBe('tap')
  })

  it('persists mode writes', () => {
    const storage = makeMemoryStorage()
    writeStoredMicMode('tap', storage)
    expect(storage.data.get(MIC_MODE_STORAGE_KEY)).toBe('tap')
  })
})
