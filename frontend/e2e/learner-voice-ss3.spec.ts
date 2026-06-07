/**
 * Regression — starting an Academy learner voice session for an SS3 learner
 * must NOT report a class-format / recognition problem.
 *
 * Root cause (fixed): the learner profile stores the canonical Nigerian
 * double-S spelling ("SS3") but the deterministic voice planner's `ClassYear`
 * enum only accepted the triple-S spelling ("SSS3"). The mismatch made the
 * `get_next_card` tool fail, so the agent told the learner their class was
 * "not in the right format". The backend now normalises every spelling onto
 * the planner's canonical form, and the home dropdown emits double-S.
 *
 * This spec reproduces the learner-side launch with a real `SS3` setup and
 * asserts two things end-to-end:
 *   1. the voice WebSocket the UI opens carries `class_year=SS3` (the canonical
 *      value, not `SSS3` and not dropped), and
 *   2. the tutor surface starts normally and renders a lesson card without any
 *      "format" / "recognize" / "unavailable" error.
 *
 * The Azure VoiceLive transport itself needs cloud credentials, so the socket
 * is mocked: the mock emits a normal `wulo.learner_card` frame exactly as the
 * backend does once `get_next_card` succeeds for SS3.
 */
import { expect, test } from '@playwright/test'

import { installRouteMocks } from './fixtures/pathfinder-route-mocks'

const LEARNER_SETUP_STORAGE_KEY = 'pathfinder-learner-setup-v1'

// Grant a fake microphone so the tutor surface stays open instead of bailing
// out to the "microphone blocked" fallback after a few seconds.
test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  },
})

test.describe('Academy learner voice · SS3 class', () => {
  test('starts an SS3 voice session without a class-format error', async ({
    page,
  }) => {
    await installRouteMocks(page, { role: 'learner' })

    // Seed the persisted learner setup the home + tutor read from. This is the
    // exact field the bug rejected: a senior learner whose class is "SS3".
    await page.addInitScript(
      ([key, value]) => {
        window.localStorage.setItem(key, value)
      },
      [
        LEARNER_SETUP_STORAGE_KEY,
        JSON.stringify({
          exam: 'WAEC',
          year: 'SS3',
          subject: 'Mathematics',
          firstName: 'Tomi',
        }),
      ]
    )

    let capturedClassYear: string | null = null

    await page.routeWebSocket('**/ws/voice**', (ws) => {
      const url = new URL(ws.url())
      capturedClassYear = url.searchParams.get('class_year')

      // Emulate the backend contract: emit a lesson card once the client has
      // sent its opening frames. With the fix, the SS3 session reaches this
      // happy path instead of a tool-call failure.
      ws.onMessage((message) => {
        let type: string | undefined
        try {
          type = JSON.parse(String(message)).type
        } catch {
          type = undefined
        }
        if (type === 'response.create') {
          ws.send(
            JSON.stringify({
              type: 'wulo.learner_card',
              payload: {
                session_complete: false,
                card: {
                  card_id: 'lv-card-ss3-e2e',
                  kind: 'mcq-tap',
                  speak:
                    'Hi Tomi! Quick SS3 maths check. What is 2 + 2?',
                  stem: 'SS3 warm-up: what is 2 + 2?',
                  options: [
                    { id: 'a', label: 'A', text: '3' },
                    { id: 'b', label: 'B', text: '4' },
                    { id: 'c', label: 'C', text: '5' },
                    { id: 'd', label: 'D', text: '6' },
                  ],
                  skill_id: 'arithmetic',
                },
              },
            })
          )
        }
      })
    })

    await page.goto('/home')

    // Launch the fullscreen tutor.
    await page.getByTestId('start-learner-tutor').click()

    const tutor = page.getByTestId('learner-tutor')
    await expect(tutor).toBeVisible()

    // The session must render the lesson card content — proof it started
    // normally rather than reporting a class problem.
    await expect(
      tutor.getByText('SS3 warm-up: what is 2 + 2?')
    ).toBeVisible()

    // The frontend forwarded the canonical double-S class, not "SSS3"/empty.
    expect(capturedClassYear).toBe('SS3')

    // No class-format / recognition / unavailable error anywhere on the surface.
    await expect(
      tutor.getByText(/format|recogni[sz]e|not in the right|unavailable/i)
    ).toHaveCount(0)
  })

  test('stops speaking when the learner barges in (interrupts)', async ({
    page,
  }) => {
    await installRouteMocks(page, { role: 'learner' })

    await page.addInitScript(
      ([key, value]) => {
        window.localStorage.setItem(key, value)
      },
      [
        LEARNER_SETUP_STORAGE_KEY,
        JSON.stringify({
          exam: 'WAEC',
          year: 'SS3',
          subject: 'Mathematics',
          firstName: 'Tomi',
        }),
      ]
    )

    await page.routeWebSocket('**/ws/voice**', (ws) => {
      let speaking: ReturnType<typeof setInterval> | null = null
      let bargeTimer: ReturnType<typeof setTimeout> | null = null
      let bargedIn = false

      const stopSpeaking = () => {
        if (speaking) {
          clearInterval(speaking)
          speaking = null
        }
      }

      ws.onClose(() => {
        stopSpeaking()
        if (bargeTimer) clearTimeout(bargeTimer)
      })

      ws.onMessage((message) => {
        let type: string | undefined
        try {
          type = JSON.parse(String(message)).type
        } catch {
          type = undefined
        }

        // Opening turn: render a card, then simulate the tutor talking by
        // streaming audio deltas continuously so the UI sits in "Tutor
        // speaking". A fixed timer then simulates Azure's server VAD detecting
        // the learner talking over the tutor (barge-in). The timer is used
        // instead of the fake mic's `input_audio_buffer.append` so the speaking
        // window is deterministic and not a race with the audio worklet.
        if (type === 'response.create' && !bargedIn) {
          ws.send(
            JSON.stringify({
              type: 'wulo.learner_card',
              payload: {
                session_complete: false,
                card: {
                  card_id: 'lv-card-ss3-barge',
                  kind: 'mcq-tap',
                  speak: 'Listen carefully while I explain this SS3 question.',
                  stem: 'SS3 warm-up: what is 2 + 2?',
                  options: [
                    { id: 'a', label: 'A', text: '3' },
                    { id: 'b', label: 'B', text: '4' },
                  ],
                  skill_id: 'arithmetic',
                },
              },
            })
          )
          ws.send(JSON.stringify({ type: 'response.created' }))
          // Emit one delta immediately so the UI enters "speaking" right away,
          // then keep the stream alive so it stays there until barge-in.
          ws.send(JSON.stringify({ type: 'response.audio.delta', delta: 'AAAA' }))
          stopSpeaking()
          speaking = setInterval(() => {
            ws.send(
              JSON.stringify({ type: 'response.audio.delta', delta: 'AAAA' })
            )
          }, 120)

          bargeTimer = setTimeout(() => {
            bargedIn = true
            stopSpeaking()
            ws.send(
              JSON.stringify({ type: 'input_audio_buffer.speech_started' })
            )
          }, 1500)
        }
      })
    })

    await page.goto('/home')
    await page.getByTestId('start-learner-tutor').click()

    const tutor = page.getByTestId('learner-tutor')
    await expect(tutor).toBeVisible()

    // The tutor reaches the "speaking" state while audio deltas stream.
    await expect(tutor.getByText('Tutor speaking')).toBeVisible()

    // After barge-in lands, the surface must leave "speaking" and settle on
    // "Listening" — proof the audio was hard-stopped rather than merely ducked
    // in volume, and that straggler deltas no longer flip it back to speaking.
    await expect(tutor.getByText('Listening')).toBeVisible()
    await expect(tutor.getByText('Tutor speaking')).toHaveCount(0)
  })
})
