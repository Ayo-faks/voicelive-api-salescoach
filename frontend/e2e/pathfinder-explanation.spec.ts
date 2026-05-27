/**
 * Pathfinder · ExplanationSurface (W3-B) e2e.
 *
 * MVP §4.1 "no citation, no answer" — exercised end-to-end:
 *   1. A query that grounds returns a hits block with at least one citation.
 *   2. A query that misses the retriever threshold renders the RefusalCard
 *      with reason="no_grounding" and no answer body.
 *
 * The `ExplanationSurface` component lives in
 * `frontend/src/learning/components/ExplanationSurface.tsx` and is intentionally
 * not yet mounted in `PathfinderLearnApp.tsx` (frozen per MVP §3). It becomes
 * user-visible in W4 when the generator + route mount lands at
 * `/learning/explain`. Until then this spec is `test.fixme`'d so it is
 * discoverable in the suite but does not falsely pass.
 *
 * To unfreeze: when W4 mounts the surface, remove the `test.fixme()` line
 * and run `npm run e2e -- frontend/e2e/pathfinder-explanation.spec.ts`.
 */
import { expect, test, type Route } from '@playwright/test'

const EXPLAIN_ROUTE = '/learning/explain'
const API_PATH = '**/api/learning/explain'

const GROUNDED_RESPONSE = {
  lang: 'en',
  query: 'how do I add fractions',
  subject: 'maths',
  year_group: 'JSS3',
  similarity_threshold: 0.5,
  hits: [
    {
      node_id: 'wiki:maths:fractions:add',
      version: '1.0.0',
      title: 'Adding fractions with unlike denominators',
      subject: 'maths',
      year_group: 'JSS3',
      topic: 'fractions',
      anchor: 'common-denominator',
      score: 0.82,
      snippet:
        'To add fractions with unlike denominators, find a common denominator first…',
      status: 'approved',
    },
  ],
  refusal: null,
  explanation: null,
}

const REFUSAL_RESPONSE = {
  lang: 'en',
  query: 'tell me about quantum chromodynamics',
  subject: null,
  year_group: null,
  similarity_threshold: 0.5,
  hits: [],
  refusal: {
    reason: 'no_grounding',
    message:
      "I can't find this in the approved Pathfinder wiki yet. Try a different question or a different topic.",
    suggestion: 'Try a topic from the JSS3 or SS3 syllabus.',
  },
  explanation: null,
}

async function stub(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

test.describe('Pathfinder · ExplanationSurface (W3-B)', () => {
  // Unmount until W4: surface is not yet wired into the routed shell.
  test.fixme(
    true,
    'ExplanationSurface is not mounted in PathfinderLearnApp until W4 (MVP §4.1 generator). ' +
      'Vitest contract test (ExplanationSurface.test.tsx) covers the component in isolation; ' +
      'this Playwright runs end-to-end as soon as the /learning/explain route lands.'
  )

  test('grounded query renders hits with citations', async ({ page }) => {
    await page.route(API_PATH, (route) => stub(route, GROUNDED_RESPONSE))
    await page.goto(EXPLAIN_ROUTE)

    const surface = page.getByTestId('explanation-surface')
    await expect(surface).toBeVisible()

    await page
      .getByTestId('explanation-input')
      .fill('how do I add fractions')
    await page.getByTestId('explanation-submit').click()

    const hits = page.getByTestId('hits-block')
    await expect(hits).toBeVisible()
    await expect(hits).toContainText('Adding fractions with unlike denominators')

    // Hard gate #1: hits must surface their source node id / version.
    await expect(hits).toContainText('wiki:maths:fractions:add')
    await expect(hits).toContainText('1.0.0')

    // No refusal card on a grounded answer.
    await expect(page.getByTestId('refusal-card')).toHaveCount(0)
  })

  test('below-threshold query renders RefusalCard, no answer body', async ({
    page,
  }) => {
    await page.route(API_PATH, (route) => stub(route, REFUSAL_RESPONSE))
    await page.goto(EXPLAIN_ROUTE)

    await page
      .getByTestId('explanation-input')
      .fill('tell me about quantum chromodynamics')
    await page.getByTestId('explanation-submit').click()

    const refusal = page.getByTestId('refusal-card')
    await expect(refusal).toBeVisible()
    await expect(page.getByTestId('refusal-reason')).toContainText('no_grounding')
    await expect(page.getByTestId('refusal-suggestion')).toBeVisible()

    // Hard gate #1: no citation → no answer.
    await expect(page.getByTestId('hits-block')).toHaveCount(0)
  })

  test('no direct provider calls from the browser (egress contract)', async ({
    page,
  }) => {
    const forbiddenHosts = [
      'api.openai.com',
      'api.anthropic.com',
      'generativelanguage.googleapis.com',
      'aiplatform.googleapis.com',
      '.openai.azure.com',
      'api.cohere.ai',
    ]
    const violations: string[] = []
    page.on('request', (req) => {
      const url = req.url()
      if (forbiddenHosts.some((h) => url.includes(h))) {
        violations.push(url)
      }
    })

    await page.route(API_PATH, (route) => stub(route, GROUNDED_RESPONSE))
    await page.goto(EXPLAIN_ROUTE)
    await page.getByTestId('explanation-input').fill('how do I add fractions')
    await page.getByTestId('explanation-submit').click()
    await expect(page.getByTestId('hits-block')).toBeVisible()

    expect(violations, 'browser must not call LLM providers directly').toEqual(
      []
    )
  })
})
