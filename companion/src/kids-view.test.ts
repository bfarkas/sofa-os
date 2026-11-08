import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KidsStatus } from '@sofa/shared';
import { clock, statusText, topupView } from './kids-view.ts';

const status = (over: Partial<KidsStatus> = {}): KidsStatus => ({ active: true, tv: 'on', dailySeconds: 2400, topUpSeconds: 0, usedSeconds: 0, remainingSeconds: 2400, donePending: false, resetsAt: '2026-11-09T03:00:00.000Z', pinSet: true, ...over });

test('clock shows minutes and seconds', () => {
  assert.equal(clock(0), '0:00');
  assert.equal(clock(65), '1:05');
  assert.equal(clock(2400), '40:00');
  assert.equal(clock(-5), '0:00');
});

test('the Top-up page shows the running allowance, expired, or no allowance', () => {
  assert.deepEqual(topupView(status({ remainingSeconds: 290 })), { kind: 'running', left: '4:50', text: 'left today. The clock is running.' });
  assert.equal(topupView(status({ remainingSeconds: 290, tv: 'off' })).text, 'left today. The clock is waiting for the TV.');
  assert.equal(topupView(status({ remainingSeconds: 0, usedSeconds: 2400 })).kind, 'expired');
  assert.match(topupView(status({ remainingSeconds: 0 })).text, /^Expired/);
  assert.equal(topupView(status({ active: false })).kind, 'none');
  assert.match(topupView(status({ active: false, remainingSeconds: 0 })).text, /^No allowance running/, 'off wins over zero');
});

test('the status line says what is on, the TV, and the time', () => {
  assert.equal(statusText(status({ remainingSeconds: 1500 })), 'Kids Mode is on. TV: on. 25:00 of 40 min left today.');
  assert.equal(statusText(status({ topUpSeconds: 300, dailySeconds: 2400, remainingSeconds: 60, tv: 'pending' })), 'Kids Mode is on. TV: on, not confirmed yet. 1:00 of 45 min left today (5 min Top-up).');
  assert.match(statusText(status({ remainingSeconds: 0 })), /used up\.$/);
  assert.match(statusText(status({ active: false })), /^Kids Mode is off\./);
});
