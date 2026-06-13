/**
 * Cookie consent configuration using vanilla-cookieconsent (Orestbida, MIT).
 * Clarity (analytics) only loads after the user opts in.
 *
 * Child-safety seal: Microsoft Clarity must never record a minor's session
 * (Children's Code; Microsoft's own guidance forbids Clarity on under-18
 * audiences). Clarity is therefore gated on TWO conditions — analytics
 * consent AND `!childModeActive`. When child mode is entered we revoke
 * Clarity consent so any already-running instance halts uploads and clears
 * its cookies; we never inject the tag while a child is on screen. This keeps
 * the QA "zero-telemetry seal" (no `clarity.ms` requests during a child
 * session) intact even after consent was granted by an adult earlier.
 */
import 'vanilla-cookieconsent/dist/cookieconsent.css'
import * as CookieConsent from 'vanilla-cookieconsent'

const CLARITY_ID = 'w8lm78zo88'

type ClarityFn = ((...args: unknown[]) => void) & { q?: unknown[] }

declare global {
  interface Window {
    clarity?: ClarityFn
  }
}

let analyticsConsented = false
let childModeActive = false

function injectClarityTag(): void {
  if (window.clarity) return
  const clarity: ClarityFn = (...args: unknown[]) => {
    clarity.q = clarity.q ?? []
    clarity.q.push(args)
  }
  window.clarity = clarity
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.clarity.ms/tag/${CLARITY_ID}`
  const firstScript = document.getElementsByTagName('script')[0]
  firstScript?.parentNode?.insertBefore(script, firstScript)
}

/**
 * Reconcile Clarity's runtime state with current consent + child mode.
 * Safe to call repeatedly (idempotent).
 */
function applyClarityState(): void {
  if (typeof window === 'undefined') return

  if (childModeActive || !analyticsConsented) {
    // A minor is on screen, or consent was withdrawn: stop any live capture.
    // `consent(false)` halts uploads and clears Clarity's cookies. We never
    // inject the tag in this state.
    window.clarity?.('consent', false)
    return
  }

  // Adult context with analytics consent: load (if needed) and grant.
  injectClarityTag()
  window.clarity?.('consent', true)
}

function loadClarity(): void {
  analyticsConsented = true
  applyClarityState()
}

/** Record withdrawal of analytics consent and stop any live capture. */
function setAnalyticsConsent(consented: boolean): void {
  analyticsConsented = consented
  applyClarityState()
}

/**
 * Toggle the child-mode seal. Call with `true` whenever a minor's surface is
 * active (e.g. App `isChildMode`, learner shell) and `false` when control
 * returns to a verified adult. Suspends/resumes Clarity accordingly.
 */
export function setClarityChildMode(active: boolean): void {
  childModeActive = active
  applyClarityState()
}

export function initCookieConsent(): void {
  CookieConsent.run({
    guiOptions: {
      consentModal: {
        layout: 'box inline',
        position: 'bottom right',
      },
      preferencesModal: {
        layout: 'box',
      },
    },
    categories: {
      necessary: {
        enabled: true,
        readOnly: true,
      },
      analytics: {
        enabled: false,
        readOnly: false,
        autoClear: {
          cookies: [{ name: /^_cl/ }],
        },
      },
    },
    language: {
      default: 'en',
      translations: {
        en: {
          consentModal: {
            title: 'We use cookies',
            description:
              'Wulo uses essential cookies for the app to work. We also use Microsoft Clarity (analytics) to understand how you use the app — only with your permission. <a href="/privacy">Privacy Policy</a>',
            acceptAllBtn: 'Accept all',
            acceptNecessaryBtn: 'Essential only',
            showPreferencesBtn: 'Manage preferences',
          },
          preferencesModal: {
            title: 'Cookie preferences',
            acceptAllBtn: 'Accept all',
            acceptNecessaryBtn: 'Essential only',
            savePreferencesBtn: 'Save preferences',
            sections: [
              {
                title: 'Essential cookies',
                description:
                  'These cookies are required for the app to function (authentication, UI preferences). They cannot be disabled.',
                linkedCategory: 'necessary',
              },
              {
                title: 'Analytics cookies',
                description:
                  'Microsoft Clarity helps us understand how the app is used through session replays and heatmaps. No data is shared with third parties for advertising.',
                linkedCategory: 'analytics',
              },
            ],
          },
        },
      },
    },
    onConsent: () => {
      if (CookieConsent.acceptedCategory('analytics')) {
        loadClarity()
      } else {
        setAnalyticsConsent(false)
      }
    },
    onChange: () => {
      if (CookieConsent.acceptedCategory('analytics')) {
        loadClarity()
      } else {
        setAnalyticsConsent(false)
      }
    },
  })
}
