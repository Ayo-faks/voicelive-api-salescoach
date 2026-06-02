export type ShareChannel = 'copy' | 'web_share' | 'whatsapp_fallback'

export type ShareResult =
  | { ok: true; channel: ShareChannel }
  | { ok: false; channel: ShareChannel; reason: 'aborted' | 'unavailable' }

export async function copyParentSummary(text: string): Promise<ShareResult> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return { ok: false, channel: 'copy', reason: 'unavailable' }
  }
  try {
    await navigator.clipboard.writeText(text)
    return { ok: true, channel: 'copy' }
  } catch {
    return { ok: false, channel: 'copy', reason: 'unavailable' }
  }
}

export async function shareParentSummary(text: string): Promise<ShareResult> {
  const shareData = { text, title: 'Wulo Academy update' }
  const canUseWebShare =
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    (typeof navigator.canShare !== 'function' || navigator.canShare(shareData))
  if (canUseWebShare) {
    try {
      await navigator.share(shareData)
      return { ok: true, channel: 'web_share' }
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') {
        return { ok: false, channel: 'web_share', reason: 'aborted' }
      }
    }
  }
  const href = `https://wa.me/?text=${encodeURIComponent(text)}`
  if (typeof window !== 'undefined') {
    window.open(href, '_blank', 'noopener,noreferrer')
  }
  return { ok: true, channel: 'whatsapp_fallback' }
}
