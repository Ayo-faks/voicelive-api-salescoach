import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyParentSummary, shareParentSummary } from './parent-share'

const originalNavigator = globalThis.navigator
const originalOpen = window.open

function setNavigator(stub: Partial<Navigator>) {
  Object.defineProperty(globalThis, 'navigator', {
    value: stub as Navigator,
    configurable: true,
    writable: true,
  })
}

describe('copyParentSummary', () => {
  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    })
  })

  it('returns ok=true on success and writes the text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setNavigator({ clipboard: { writeText } as unknown as Clipboard })
    const result = await copyParentSummary('hello')
    expect(writeText).toHaveBeenCalledWith('hello')
    expect(result).toEqual({ ok: true, channel: 'copy' })
  })

  it('returns unavailable when clipboard API is missing', async () => {
    setNavigator({})
    const result = await copyParentSummary('hello')
    expect(result).toEqual({ ok: false, channel: 'copy', reason: 'unavailable' })
  })

  it('returns unavailable when writeText throws', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    setNavigator({ clipboard: { writeText } as unknown as Clipboard })
    const result = await copyParentSummary('hello')
    expect(result).toEqual({ ok: false, channel: 'copy', reason: 'unavailable' })
  })
})

describe('shareParentSummary', () => {
  beforeEach(() => {
    window.open = vi.fn() as unknown as typeof window.open
  })
  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    })
    window.open = originalOpen
  })

  it('uses Web Share API when available and reports web_share', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    setNavigator({ share } as unknown as Navigator)
    const result = await shareParentSummary('msg')
    expect(share).toHaveBeenCalledWith({ text: 'msg', title: 'Pathfinder update' })
    expect(result).toEqual({ ok: true, channel: 'web_share' })
    expect(window.open).not.toHaveBeenCalled()
  })

  it('falls back to WhatsApp when navigator.share is missing', async () => {
    setNavigator({})
    const result = await shareParentSummary('msg with space')
    expect(window.open).toHaveBeenCalledWith(
      'https://wa.me/?text=msg%20with%20space',
      '_blank',
      'noopener,noreferrer',
    )
    expect(result).toEqual({ ok: true, channel: 'whatsapp_fallback' })
  })

  it('reports aborted when the user dismisses the share sheet', async () => {
    const share = vi.fn().mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    )
    setNavigator({ share } as unknown as Navigator)
    const result = await shareParentSummary('msg')
    expect(result).toEqual({ ok: false, channel: 'web_share', reason: 'aborted' })
    expect(window.open).not.toHaveBeenCalled()
  })

  it('falls back to WhatsApp when navigator.canShare rejects the payload', async () => {
    const share = vi.fn()
    const canShare = vi.fn().mockReturnValue(false)
    setNavigator({ share, canShare } as unknown as Navigator)
    const result = await shareParentSummary('msg')
    expect(share).not.toHaveBeenCalled()
    expect(window.open).toHaveBeenCalled()
    expect(result.channel).toBe('whatsapp_fallback')
  })
})
