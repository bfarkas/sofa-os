import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SystemStatus } from '@sofa/shared';
import { backupText, outageText } from './system-banner.ts';

const s = (o: Partial<SystemStatus> = {}): SystemStatus => ({ homeAssistant: 'on', haReachable: true, haSince: null, backup: { lastAt: null, lastError: null }, ...o });

test('the banner shows only for a Home Assistant that was reached and now is not', () => {
  assert.equal(outageText(s()), null);
  assert.equal(outageText(s({ haReachable: null })), null); // unknown yet, or not set up
  assert.match(outageText(s({ haReachable: false }))!, /^Home Assistant is not reachable\. Until it is back: .*Phone Remote\.$/);
  assert.match(outageText(s({ haReachable: false, haSince: '2026-11-09T10:00:00Z' }))!, / since \d/);
});

test('backup text: none, a time, a failure', () => {
  assert.equal(backupText(s()), 'No backup yet.');
  assert.match(backupText(s({ backup: { lastAt: '2026-11-09T03:00:00Z', lastError: null } })), /^Last backup: /);
  assert.match(backupText(s({ backup: { lastAt: '2026-11-09T03:00:00Z', lastError: 'x' } })), /failed/);
});
