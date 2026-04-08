/**
 * Cookie consent configuration using vanilla-cookieconsent (Orestbida, MIT).
 * Clarity (analytics) only loads after the user opts in.
 */
import 'vanilla-cookieconsent/dist/cookieconsent.css'
import * as CookieConsent from 'vanilla-cookieconsent'

const CLARITY_ID = 'w8lm78zo88'

function loadClarity(): void {
  if ((window as any).clarity) return
  ;(function (c: any, l: Document, a: string, r: string, i: string) {
    c[a] = c[a] || function (...args: any[]) { (c[a].q = c[a].q || []).push(args) }
    const t = l.createElement(r) as HTMLScriptElement
    t.async = true
    t.src = 'https://www.clarity.ms/tag/' + i
    const y = l.getElementsByTagName(r)[0]
    y.parentNode!.insertBefore(t, y)
  })(window, document, 'clarity', 'script', CLARITY_ID)
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
          cookies: [
            { name: /^_cl/ },
          ],
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
      }
    },
    onChange: () => {
      if (CookieConsent.acceptedCategory('analytics')) {
        loadClarity()
      }
    },
  })
}
