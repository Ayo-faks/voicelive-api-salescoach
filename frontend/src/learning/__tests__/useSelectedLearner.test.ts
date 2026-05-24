import { afterEach, describe, expect, it } from 'vitest'
import {
  SELECTED_LEARNER_STORAGE_KEY,
  readStoredSelectedLearnerId,
  resolveSelectedLearnerId,
  storeSelectedLearnerId,
} from '../hooks/useSelectedLearner'

const children = [
  { id: 'child-1' },
  { id: 'child-2' },
]

afterEach(() => {
  window.localStorage.clear()
})

describe('resolveSelectedLearnerId', () => {
  it('replays a stored learner when still linked', () => {
    expect(resolveSelectedLearnerId(children, 'child-2')).toBe('child-2')
  })

  it('falls back to the first linked learner when the stored learner is stale', () => {
    expect(resolveSelectedLearnerId(children, 'missing-child')).toBe('child-1')
  })

  it('returns null for an empty linked-learner list', () => {
    expect(resolveSelectedLearnerId([], 'child-1')).toBeNull()
  })
})

describe('selected learner storage helpers', () => {
  it('stores and clears the stable selected learner key', () => {
    storeSelectedLearnerId('child-2')

    expect(window.localStorage.getItem(SELECTED_LEARNER_STORAGE_KEY)).toBe('child-2')
    expect(readStoredSelectedLearnerId()).toBe('child-2')

    storeSelectedLearnerId(null)
    expect(window.localStorage.getItem(SELECTED_LEARNER_STORAGE_KEY)).toBeNull()
  })
})