import {
  test as base,
  request,
  type APIRequestContext,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test'

type AdultRole = 'therapist' | 'admin' | 'parent'

type UiStatePatch = {
  onboarding_complete?: boolean
  tours_seen?: string[]
}

interface AdultPersona {
  userId: string
  role: AdultRole
  name: string
  email: string
  uiState: UiStatePatch
}

interface AdultShell {
  context: BrowserContext
  page: Page
}

type AdultShellFixtures = {
  therapistShell: AdultShell
  adminShell: AdultShell
  parentShell: AdultShell
}

const PERSONAS: Record<AdultRole, AdultPersona> = {
  therapist: {
    userId: 'dev-therapist-001',
    role: 'therapist',
    name: 'Dev Therapist',
    email: 'dev-therapist@localhost',
    uiState: {
      onboarding_complete: true,
      // Pre-seed both auto-trigger tours therapists encounter on first
      // load (welcome on /home, dashboard on /teacher) so the help-menu
      // replay path is the only thing the test exercises.
      tours_seen: ['welcome-therapist', 'dashboard-tour'],
    },
  },
  admin: {
    userId: 'dev-admin-001',
    role: 'admin',
    name: 'Dev Admin',
    email: 'dev-admin@localhost',
    uiState: {
      onboarding_complete: true,
      // welcome-admin still auto-fires (the admin test relies on it).
      // dashboard-tour also targets /teacher, so seed it as seen to stop
      // it re-opening once welcome-admin is dismissed.
      tours_seen: ['dashboard-tour'],
    },
  },
  parent: {
    userId: 'dev-parent-001',
    role: 'parent',
    name: 'Dev Parent',
    email: 'dev-parent@localhost',
    uiState: {
      onboarding_complete: true,
      tours_seen: [],
    },
  },
}

function toAppUrl(baseURL: string, path: string): string {
  return new URL(path, baseURL).toString()
}

function buildPrincipalHeaders(persona: AdultPersona): Record<string, string> {
  return {
    'X-MS-CLIENT-PRINCIPAL-ID': persona.userId,
    'X-MS-CLIENT-PRINCIPAL-NAME': persona.name,
    'X-MS-CLIENT-PRINCIPAL-EMAIL': persona.email,
    'X-MS-CLIENT-PRINCIPAL-IDP': 'local-dev',
  }
}

async function assertOk(response: APIResponse, label: string) {
  if (response.ok()) {
    return
  }

  const body = await response.text()
  throw new Error(`${label} failed with ${response.status()}: ${body}`)
}

async function ensureAdminBootstrap(adminRequest: APIRequestContext) {
  await assertOk(await adminRequest.get('/api/auth/session'), 'bootstrap admin session')
}

async function seedPersona(baseURL: string, adminRequest: APIRequestContext, persona: AdultPersona) {
  const personaRequest = await request.newContext({
    baseURL,
    extraHTTPHeaders: buildPrincipalHeaders(persona),
  })

  try {
    await assertOk(await personaRequest.get('/api/auth/session'), `bootstrap ${persona.role} session`)
    await assertOk(
      await adminRequest.post(`/api/users/${persona.userId}/role`, {
        data: { role: persona.role },
      }),
      `assign ${persona.role} role`,
    )
    await assertOk(await personaRequest.delete('/api/me/ui-state'), `reset ${persona.role} ui state`)

    if (Object.keys(persona.uiState).length > 0) {
      await assertOk(
        await personaRequest.patch('/api/me/ui-state', {
          data: persona.uiState,
        }),
        `seed ${persona.role} ui state`,
      )
    }
  } finally {
    await personaRequest.dispose()
  }
}

async function openPersonaHome(browser: Browser, baseURL: string, persona: AdultPersona): Promise<AdultShell> {
  const context = await browser.newContext({
    extraHTTPHeaders: buildPrincipalHeaders(persona),
    viewport: { width: 1440, height: 1080 },
  })
  const page = await context.newPage()

  await page.goto(toAppUrl(baseURL, '/home'), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-testid="help-menu-trigger"]')

  return { context, page }
}

function createShellFixture(role: AdultRole) {
  return async (
    { browser, baseURL }: { browser: Browser; baseURL: string | undefined },
    run: (shell: AdultShell) => Promise<void>,
  ) => {
    if (!baseURL) {
      throw new Error('Playwright baseURL is required for adult shell fixtures')
    }

    const adminRequest = await request.newContext({ baseURL })
    await ensureAdminBootstrap(adminRequest)
    await seedPersona(baseURL, adminRequest, PERSONAS[role])

    const shell = await openPersonaHome(browser, baseURL, PERSONAS[role])

    try {
      await run(shell)
    } finally {
      await shell.context.close()
      await adminRequest.dispose()
    }
  }
}

export const test = base.extend<AdultShellFixtures>({
  therapistShell: createShellFixture('therapist'),
  adminShell: createShellFixture('admin'),
  parentShell: createShellFixture('parent'),
})

export { expect } from '@playwright/test'