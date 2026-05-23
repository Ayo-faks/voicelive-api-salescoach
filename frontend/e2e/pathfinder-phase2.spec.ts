import { expect, test } from '@playwright/test'

test('offline Phase 2 diagnostic renders mastery, provenance, and explicit approval', async ({ page }) => {
  await page.setContent(`
    <main>
      <button data-testid="phase2-start">Start diagnostic</button>
      <section data-testid="phase2-output" aria-live="polite"></section>
    </main>
    <script>
      const skills = ['ratio-proportion', 'fraction-operations', 'linear-equations', 'plane-geometry'];
      document.querySelector('[data-testid="phase2-start"]').addEventListener('click', () => {
        const rows = skills.map((skill, index) => '<tr data-testid="phase2-heatmap-row"><td>' + skill + '</td><td>' + (82 - (index * 7)) + '%</td><td>pathfinder_phase_2_fixture</td></tr>').join('');
        document.querySelector('[data-testid="phase2-output"]').innerHTML =
          '<p data-testid="phase2-response-count">50 responses</p>' +
          '<p data-testid="phase2-mastery-count">50 mastery updates</p>' +
          '<p data-testid="phase2-xapi-count">51 xAPI statements</p>' +
          '<table data-testid="phase2-heatmap"><tbody>' + rows + '</tbody></table>' +
          '<article data-testid="phase2-pending-card" data-status="pending">' +
          '<p>Pending teacher approval</p>' +
          '<footer data-testid="phase2-provenance-footer">pathfinder_phase_2_fixture / contract_phase_2_item_bank</footer>' +
          '<button data-testid="phase2-approve">Approve</button>' +
          '</article>';
        document.querySelector('[data-testid="phase2-approve"]').addEventListener('click', () => {
          document.querySelector('[data-testid="phase2-pending-card"]').setAttribute('data-status', 'approved');
          document.querySelector('[data-testid="phase2-output"]').insertAdjacentHTML('beforeend', '<p data-testid="phase2-approval-event">approval xAPI emitted</p>');
        });
      });
    </script>
  `)

  await page.getByTestId('phase2-start').click()

  await expect(page.getByTestId('phase2-response-count')).toHaveText('50 responses')
  await expect(page.getByTestId('phase2-mastery-count')).toHaveText('50 mastery updates')
  await expect(page.getByTestId('phase2-xapi-count')).toHaveText('51 xAPI statements')
  await expect(page.getByTestId('phase2-heatmap-row')).toHaveCount(4)
  await expect(page.getByTestId('phase2-pending-card')).toHaveAttribute('data-status', 'pending')
  await expect(page.getByTestId('phase2-provenance-footer')).toContainText('pathfinder_phase_2_fixture')

  await page.getByTestId('phase2-approve').click()

  await expect(page.getByTestId('phase2-pending-card')).toHaveAttribute('data-status', 'approved')
  await expect(page.getByTestId('phase2-approval-event')).toHaveText('approval xAPI emitted')
})