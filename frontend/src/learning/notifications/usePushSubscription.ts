/**
 * W8 — Web Push subscription hook for Pathfinder Learn.
 *
 * Responsibilities:
 *   1. Register `/sw.js` (idempotent — checks `navigator.serviceWorker.ready`).
 *   2. Fetch the server VAPID public key from
 *      `/api/learning/notifications/push/vapid-public-key`.
 *   3. Ask the browser for `Notification.permission` on demand
 *      (caller decides when — we do not auto-prompt on mount, to honor the
 *      kid-role parental-consent gate).
 *   4. Call `pushManager.subscribe()` and POST the result to
 *      `/api/learning/notifications/push/subscribe`.
 *
 * The hook is a no-op in browsers that lack ServiceWorker / PushManager
 * (older Safari, in-app webviews). Callers check `supported` before
 * surfacing UI.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

type PermissionState = 'default' | 'granted' | 'denied' | 'unsupported'

type SubscribeStatus = 'idle' | 'subscribing' | 'subscribed' | 'error'

export interface UsePushSubscriptionOptions {
  userId: string
  tenantId?: string
  /** Skip the prompt for users who can't consent (e.g. role==='kid'). */
  consentDeferred?: boolean
}

export interface UsePushSubscriptionResult {
  supported: boolean
  permission: PermissionState
  status: SubscribeStatus
  error: string | null
  /** Trigger the permission prompt + subscribe round-trip. */
  enable: () => Promise<boolean>
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

export function usePushSubscription(
  options: UsePushSubscriptionOptions
): UsePushSubscriptionResult {
  const { userId, tenantId, consentDeferred } = options

  const supported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window

  const [permission, setPermission] = useState<PermissionState>(() => {
    if (!supported) return 'unsupported'
    return Notification.permission as PermissionState
  })
  const [status, setStatus] = useState<SubscribeStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null)

  // Register the service worker once. We do not auto-subscribe — that's
  // gated on consent and happens in `enable()`.
  useEffect(() => {
    if (!supported) return
    let cancelled = false
    navigator.serviceWorker
      .register('/sw.js')
      .then(reg => {
        if (!cancelled) registrationRef.current = reg
      })
      .catch(err => {
        if (!cancelled) setError(`sw_register_failed: ${(err as Error).message}`)
      })
    return () => {
      cancelled = true
    }
  }, [supported])

  const enable = useCallback(async (): Promise<boolean> => {
    if (!supported) {
      setError('push_unsupported')
      return false
    }
    if (consentDeferred) {
      setError('consent_deferred')
      return false
    }

    setStatus('subscribing')
    setError(null)

    try {
      // 1) Permission prompt.
      let granted = Notification.permission
      if (granted === 'default') {
        granted = await Notification.requestPermission()
      }
      setPermission(granted as PermissionState)
      if (granted !== 'granted') {
        setStatus('error')
        setError(`permission_${granted}`)
        return false
      }

      // 2) Server VAPID public key.
      const keyResp = await fetch('/api/learning/notifications/push/vapid-public-key')
      if (!keyResp.ok) throw new Error(`vapid_key_http_${keyResp.status}`)
      const keyBody = (await keyResp.json()) as { publicKey?: string; configured?: boolean }
      if (!keyBody.configured || !keyBody.publicKey) {
        throw new Error('vapid_not_configured')
      }

      // 3) Subscribe via the SW registration.
      const registration =
        registrationRef.current ?? (await navigator.serviceWorker.ready)
      registrationRef.current = registration
      const existing = await registration.pushManager.getSubscription()
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyBody.publicKey),
        }))

      // 4) Persist server-side.
      const payload = {
        user_id: userId,
        tenant_id: tenantId,
        subscription: subscription.toJSON(),
        user_agent: navigator.userAgent,
      }
      const persist = await fetch('/api/learning/notifications/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!persist.ok) throw new Error(`subscribe_http_${persist.status}`)

      setStatus('subscribed')
      return true
    } catch (err) {
      setStatus('error')
      setError((err as Error).message || 'push_subscribe_failed')
      return false
    }
  }, [supported, consentDeferred, userId, tenantId])

  return { supported, permission, status, error, enable }
}

export interface RevisionCardInput {
  topicId: string
  label: string
  /** ISO 8601 UTC string, e.g. new Date(Date.now() + 10*60*1000).toISOString(). */
  dueAt: string
  payload?: Record<string, unknown>
}

export interface ScheduleRevisionCardsArgs {
  userId: string
  tenantId?: string
  cards: RevisionCardInput[]
}

/**
 * POST the configured spaced-retrieval schedule to the backend. Returns the
 * server-assigned card IDs on success. Used by `addWeaknessToPlan` once the
 * learner agrees to revision reminders.
 */
export async function scheduleRevisionCards(
  args: ScheduleRevisionCardsArgs
): Promise<{ scheduled: number; cardIds: string[] }> {
  const body = {
    user_id: args.userId,
    tenant_id: args.tenantId,
    cards: args.cards.map(c => ({
      topic_id: c.topicId,
      label: c.label,
      due_at: c.dueAt,
      payload: c.payload ?? {},
    })),
  }
  const resp = await fetch('/api/learning/notifications/revision-cards/schedule', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) throw new Error(`schedule_http_${resp.status}`)
  const json = (await resp.json()) as { scheduled: number; card_ids: string[] }
  return { scheduled: json.scheduled, cardIds: json.card_ids ?? [] }
}
