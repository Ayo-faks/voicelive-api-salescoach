import { describe, expect, it, vi } from 'vitest'

import {
  clearLegacySetup,
  migrateLegacySetup,
  profileToSetup,
  readLegacySetup,
  setupToProfilePatch,
} from './useLearnerProfile'
import { LEARNER_SETUP_STORAGE_KEY, DEFAULT_LEARNER_SETUP } from './useLearnerSetup'

function makeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    getItem: vi.fn((key: string) => (key in data ? data[key] : null)),
    setItem: vi.fn((key: string, value: string) => {
      data[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete data[key]
    }),
    _data: data,
  }
}

describe('useLearnerProfile helpers', () => {
  describe('readLegacySetup', () => {
    it('returns null when key absent', () => {
      const storage = makeStorage()
      expect(readLegacySetup(storage)).toBeNull()
    })

    it('parses a valid legacy payload', () => {
      const storage = makeStorage({
        [LEARNER_SETUP_STORAGE_KEY]: JSON.stringify({
          exam: 'WAEC',
          year: 'SSS2',
          subject: 'Mathematics',
          firstName: 'Tomi',
        }),
      })
      expect(readLegacySetup(storage)).toEqual({
        exam: 'WAEC',
        year: 'SSS2',
        subject: 'Mathematics',
        firstName: 'Tomi',
      })
    })

    it('returns null when JSON is invalid', () => {
      const storage = makeStorage({ [LEARNER_SETUP_STORAGE_KEY]: '{not json' })
      expect(readLegacySetup(storage)).toBeNull()
    })
  })

  describe('setupToProfilePatch', () => {
    it('emits a patch with only the populated fields', () => {
      expect(
        setupToProfilePatch({ exam: 'WAEC', year: 'SS2', subject: 'Maths', firstName: '' }),
      ).toEqual({
        exam: 'WAEC',
        year_group: 'SS2',
        subjects: ['Maths'],
      })
    })

    it('includes the display name when firstName is set', () => {
      expect(
        setupToProfilePatch({ exam: '', year: '', subject: '', firstName: 'Tomi' }),
      ).toEqual({ display_name: 'Tomi' })
    })

    it('produces an empty patch for a blank setup', () => {
      expect(
        setupToProfilePatch({ exam: '', year: '', subject: '', firstName: '' }),
      ).toEqual({})
    })
  })

  describe('profileToSetup', () => {
    it('returns the fallback when profile is null', () => {
      expect(profileToSetup(null)).toEqual(DEFAULT_LEARNER_SETUP)
    })

    it('maps profile fields into the setup shape', () => {
      expect(
        profileToSetup({
          display_name: 'Ada',
          exam: 'JAMB',
          year_group: 'SS3',
          subjects: ['Physics', 'Maths'],
        }),
      ).toEqual({
        exam: 'JAMB',
        year: 'SS3',
        subject: 'Physics',
        firstName: 'Ada',
      })
    })
  })

  describe('migrateLegacySetup', () => {
    it('does nothing when there is no legacy payload', async () => {
      const storage = makeStorage()
      const patch = vi.fn()
      const result = await migrateLegacySetup(storage, patch)
      expect(result).toBeNull()
      expect(patch).not.toHaveBeenCalled()
      expect(storage.removeItem).not.toHaveBeenCalled()
    })

    it('clears the legacy key only AFTER the PATCH resolves', async () => {
      const storage = makeStorage({
        [LEARNER_SETUP_STORAGE_KEY]: JSON.stringify({
          exam: 'WAEC',
          year: 'SSS2',
          subject: 'Mathematics',
          firstName: 'Tomi',
        }),
      })
      const events: string[] = []
      const patch = vi.fn(async (p: object) => {
        events.push(`patch:${JSON.stringify(p)}`)
        return { profile: {}, consents: [], needs_onboarding: true }
      })
      storage.removeItem.mockImplementation(() => {
        events.push('remove')
      })

      const result = await migrateLegacySetup(storage, patch)

      expect(patch).toHaveBeenCalledTimes(1)
      expect(result).toEqual({ profile: {}, consents: [], needs_onboarding: true })
      expect(events[0]).toMatch(/^patch:/)
      expect(events[1]).toBe('remove')
    })

    it('does not clear the legacy key when the PATCH rejects', async () => {
      const storage = makeStorage({
        [LEARNER_SETUP_STORAGE_KEY]: JSON.stringify({
          exam: 'WAEC',
          year: 'SSS2',
          subject: 'Mathematics',
          firstName: 'Tomi',
        }),
      })
      const patch = vi.fn(async () => {
        throw new Error('boom')
      })

      await expect(migrateLegacySetup(storage, patch)).rejects.toThrow('boom')
      expect(storage.removeItem).not.toHaveBeenCalled()
    })
  })

  describe('clearLegacySetup', () => {
    it('removes the storage key', () => {
      const storage = makeStorage({ [LEARNER_SETUP_STORAGE_KEY]: 'x' })
      clearLegacySetup(storage)
      expect(storage.removeItem).toHaveBeenCalledWith(LEARNER_SETUP_STORAGE_KEY)
    })
  })
})
