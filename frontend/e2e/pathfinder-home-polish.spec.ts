/**
 * Pathfinder · learner /home polish e2e
 *
 * Covers the smaller surface fixes that the long end-to-end approval spec
 * doesn't touch: disclosure default+persistence, learner hero polish,
 * parent-share telemetry, and the voice CTA states (driven by the
 * dev-only ?__voiceState= URL switch).
 */
import { expect, test, type Browser } from '@playwright/test'
import { installRouteMocks } from './fixtures/pathfinder-route-mocks'

const LEARNER_PERSONA = {
  userId: 'dev-learner-polish-001',
  name: 'Polish Learner',
  email: 'polish-learner@localhost',
} as const

async function newLearnerPage(browser: Browser) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await installRouteMocks(page, {
    role: 'learner',
    userId: LEARNER_PERSONA.userId,
  })
  return { ctx, page }
}

test.describe('Pathfinder · learner /home polish', () => {
  test('disclosures default closed and persist across reload', async ({
    browser,
  }) => {
    const { ctx, page } = await newLearnerPage(browser)
    try {
      await page.goto('/home')
      const career = page.getByTestId('career-pathway-suggestions').locator('details')
      const parent = page.getByTestId('parent-share-summary').locator('details')
      await expect(career).not.toHaveAttribute('open', /.*/)
      await expect(parent).not.toHaveAttribute('open', /.*/)

      await page.getByTestId('career-disclosure-summary').click()
      await expect(career).toHaveAttribute('open', /.*/)

      await page.reload()
      await expect(
        page.getByTestId('career-pathway-suggestions').locator('details')
      ).toHaveAttribute('open', /.*/)
    } finally {
      await ctx.close()
    }
  })

  test('learner hero omits the launch and evidence chips', async ({ browser }) => {
    const { ctx, page } = await newLearnerPage(browser)
    try {
      await page.goto('/home')
      await expect(page.getByTestId('start-learner-tutor')).toBeVisible()
      await expect(page.getByText(/tap to start/i)).toHaveCount(0)
      await expect(page.getByTestId('learner-trust-badges')).toHaveCount(0)
      await expect(page.getByText('Evidence log')).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  })

  test('mobile learner hero keeps primary elements centered and contained', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await ctx.newPage()
    await installRouteMocks(page, {
      role: 'learner',
      userId: LEARNER_PERSONA.userId,
    })
    try {
      await page.goto('/home')
      const hero = page.getByTestId('learner-hero-card')
      const centeredItems = [
        page.getByTestId('learner-hero-title'),
        page.getByTestId('start-checkin'),
        page.getByTestId('start-learner-tutor'),
      ]

      await expect(hero).toBeVisible()
      for (const item of centeredItems) {
        await expect(item).toBeVisible()
      }

      const heroBox = await hero.boundingBox()
      if (!heroBox) throw new Error('Expected learner hero card bounds')
      const heroCenter = heroBox.x + heroBox.width / 2
      const heroRight = heroBox.x + heroBox.width

      for (const item of centeredItems) {
        const box = await item.boundingBox()
        if (!box) throw new Error('Expected centered learner hero item bounds')
        const itemCenter = box.x + box.width / 2
        expect(Math.abs(itemCenter - heroCenter)).toBeLessThan(3)
        expect(box.x).toBeGreaterThanOrEqual(heroBox.x)
        expect(box.x + box.width).toBeLessThanOrEqual(heroRight)
      }
    } finally {
      await ctx.close()
    }
  })

  test('homepage Take a tour launches in-place instead of routing to pathways', async ({
    browser,
  }) => {
    const { ctx, page } = await newLearnerPage(browser)
    const mainFrameUrls: string[] = []
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) mainFrameUrls.push(frame.url())
    })
    try {
      await page.goto('/home')
      const initialPath = new URL(page.url()).pathname
      await page.getByTestId('help-menu-trigger').click()
      await expect(page.getByTestId('pathfinder-learn-app')).toBeVisible()
      await expect(page.getByTestId('learner-hero-title')).toBeVisible()
      expect(new URL(page.url()).pathname).toBe(initialPath)

      const driver = page.getByTestId('tour-driver')
      await expect(driver).toHaveAttribute('data-tour-id', 'welcome-learner', {
        timeout: 800,
      })
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 800 })
      await expect(page.getByTestId('wulo-tour-tooltip')).toHaveAttribute(
        'data-tour-step-active',
        'learner-hero-title',
        { timeout: 800 }
      )
      await expect
        .poll(
          async () =>
            page
              .getByTestId('wulo-tour-tooltip')
              .evaluate((element) => Number(getComputedStyle(element).opacity)),
          { timeout: 800 }
        )
        .toBeGreaterThan(0.95)
      expect(new URL(page.url()).pathname).toBe(initialPath)
      await expect(page.getByTestId('route-pathways-explorer')).toHaveCount(0)
      expect(mainFrameUrls.every(url => !url.startsWith('about:blank'))).toBe(
        true
      )

      const overlayStyle = await page.evaluate(() => {
        const portal = document.getElementById('react-joyride-portal')
        const candidates = Array.from(
          (portal ?? document.body).querySelectorAll<HTMLElement>('*')
        )
        for (const element of candidates) {
          const style = window.getComputedStyle(element)
          const backdropFilter =
            style.backdropFilter ||
            (style as CSSStyleDeclaration & { webkitBackdropFilter?: string })
              .webkitBackdropFilter ||
            ''
          const filter = style.filter || ''
          if (
            (style.position === 'fixed' || style.position === 'absolute') &&
            (backdropFilter.includes('blur') || filter.includes('blur'))
          ) {
            return {
              backdropFilter,
              filter,
              backgroundColor: style.backgroundColor,
              fill: portal?.querySelector('svg path[fill]')?.getAttribute('fill') ?? '',
            }
          }
        }
        return null
      })
      expect(overlayStyle).not.toBeNull()
      expect(overlayStyle?.fill).toBe('rgba(15, 23, 42, 0.45)')
      const filterMatch = overlayStyle?.filter.match(/blur\((\d+(?:\.\d+)?)px\)/)
      const backdropMatch = overlayStyle?.backdropFilter.match(
        /blur\((\d+(?:\.\d+)?)px\)/
      )
      expect(filterMatch ? Number(filterMatch[1]) <= 4 : true).toBe(true)
      expect(backdropMatch ? Number(backdropMatch[1]) <= 4 : true).toBe(true)
    } finally {
      await ctx.close()
    }
  })

  test('parent-share copy logs telemetry', async ({ browser }) => {
    const { ctx, page } = await newLearnerPage(browser)
    try {
      await page.goto('/home')
      // Stub the clipboard so the copy helper resolves cleanly in headless.
      await page.evaluate(() => {
        const writeText = () => Promise.resolve()
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText },
        })
        window.localStorage.removeItem('pathfinder-events')
      })
      await page.getByTestId('parent-disclosure-summary').click()
      await page.getByTestId('parent-share-copy').click()
      // Telemetry is flushed synchronously to localStorage; poll briefly.
      await expect
        .poll(async () =>
          page.evaluate(() => {
            try {
              const raw = window.localStorage.getItem('pathfinder-events') ?? '[]'
              const events = JSON.parse(raw) as Array<{
                name: string
                props?: { channel?: string }
              }>
              return events.find(
                (e) =>
                  e.name === 'parent_summary_shared' &&
                  e.props?.channel === 'copy'
              )
                ? 'found'
                : 'missing'
            } catch {
              return 'error'
            }
          })
        )
        .toBe('found')
    } finally {
      await ctx.close()
    }
  })

  test('voice state injection does not restore removed hero chip', async ({
    browser,
  }) => {
    const { ctx, page } = await newLearnerPage(browser)
    try {
      await page.goto('/home?__voiceState=listening')
      await expect(page.getByTestId('start-learner-tutor')).toBeVisible()
      await expect(page.getByTestId('voice-cta-pill')).toHaveCount(0)
      await expect(page.getByText(/tap to start/i)).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  })
})
