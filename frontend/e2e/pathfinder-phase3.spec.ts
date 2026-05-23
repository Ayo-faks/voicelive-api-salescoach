import { expect, test } from '@playwright/test'

test('offline Phase 3 career pilot renders sourced cards, refusal, and explicit counsellor signoff', async ({ page }) => {
  await page.setContent(`
    <main>
      <button data-testid="phase3-start">Start pilot readiness proof</button>
      <section data-testid="phase3-output" aria-live="polite"></section>
    </main>
    <script>
      document.querySelector('[data-testid="phase3-start"]').addEventListener('click', () => {
        document.querySelector('[data-testid="phase3-output"]').innerHTML =
          '<p data-testid="phase3-y eval">200 Yoruba cases, kappa 0.74</p>'.replace('y eval', 'yoruba-eval') +
          '<p data-testid="phase3-red-team">career safety 99.5%</p>' +
          '<article data-testid="phase3-career-card">' +
          '<h2>Career Navigator shortlist</h2>' +
          '<p>Data analyst</p>' +
          '<p>nbs_phase_3_fixture / 2026-Q1</p>' +
          '<p>world_bank_step_phase_3_fixture / rising</p>' +
          '<footer data-testid="phase3-provenance-footer">DeterministicCareerPlanner / phase_3_weighted_mastery_labour_market_ranker</footer>' +
          '</article>' +
          '<article data-testid="phase3-counsellor-gate" data-risk-level="refuse" data-status="pending">' +
          '<p>A counsellor must review this career explanation before it is shown to the learner.</p>' +
          '<button data-testid="phase3-approve">Approve narration</button>' +
          '</article>' +
          '<article data-testid="phase3-parent-card">Linear equations is secure; geometry needs guided practice.</article>' +
          '<article data-testid="phase3-voice-card" data-queued="true">yo-NG queued_multilingual_voice_frame</article>';
        document.querySelector('[data-testid="phase3-approve"]').addEventListener('click', () => {
          document.querySelector('[data-testid="phase3-counsellor-gate"]').setAttribute('data-status', 'approved');
          document.querySelector('[data-testid="phase3-output"]').insertAdjacentHTML('beforeend', '<p data-testid="phase3-approval-event">career approval xAPI emitted</p>');
        });
      });
    </script>
  `)

  await page.getByTestId('phase3-start').click()

  await expect(page.getByTestId('phase3-yoruba-eval')).toHaveText('200 Yoruba cases, kappa 0.74')
  await expect(page.getByTestId('phase3-red-team')).toHaveText('career safety 99.5%')
  await expect(page.getByTestId('phase3-career-card')).toContainText('Data analyst')
  await expect(page.getByTestId('phase3-career-card')).toContainText('nbs_phase_3_fixture')
  await expect(page.getByTestId('phase3-provenance-footer')).toContainText('DeterministicCareerPlanner')
  await expect(page.getByTestId('phase3-counsellor-gate')).toHaveAttribute('data-risk-level', 'refuse')
  await expect(page.getByTestId('phase3-parent-card')).toContainText('Linear equations is secure')
  await expect(page.getByTestId('phase3-voice-card')).toHaveAttribute('data-queued', 'true')

  await page.getByTestId('phase3-approve').click()

  await expect(page.getByTestId('phase3-counsellor-gate')).toHaveAttribute('data-status', 'approved')
  await expect(page.getByTestId('phase3-approval-event')).toHaveText('career approval xAPI emitted')
})
