import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { assertBridgeCopy, __test__, __envHooks } from './assertBridgeCopy'

describe('assertBridgeCopy', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>
  const originalIsDev = __envHooks.isDev

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    __envHooks.isDev = originalIsDev
  })

  it('returns input unchanged when word count ≤ 7', () => {
    expect(assertBridgeCopy('Now sort the pictures.')).toBe('Now sort the pictures.')
    expect(assertBridgeCopy('one two three four five six seven')).toBe(
      'one two three four five six seven'
    )
  })

  it('treats empty / whitespace-only input as valid and returns it unchanged', () => {
    expect(assertBridgeCopy('')).toBe('')
    expect(assertBridgeCopy('   ')).toBe('   ')
  })

  it('throws in dev when bridge copy exceeds 7 words', () => {
    __envHooks.isDev = () => true
    expect(() =>
      assertBridgeCopy('this bridge copy is far far too long indeed really')
    ).toThrowError(/BRIDGE copy must be ≤ 7 words/)
  })

  it('in prod logs a warning and truncates to 7 words', () => {
    __envHooks.isDev = () => false
    const result = assertBridgeCopy('one two three four five six seven eight nine')
    expect(result).toBe('one two three four five six seven')
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/BRIDGE copy must be ≤ 7 words/)
  })

  it('tokenizes whitespace-separated words, ignoring repeated spaces', () => {
    expect(__test__.tokenize('  a   b\tc\nd  ')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('exposes MAX_BRIDGE_WORDS = 7 (contract)', () => {
    expect(__test__.MAX_BRIDGE_WORDS).toBe(7)
  })
})
