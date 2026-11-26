import assert from 'node:assert/strict';
import test from 'node:test';
import { applyDailyLatest, parseEcos } from './fetch-rates.mjs';

test('applyDailyLatest appends newer month from daily BOK base rate', () => {
  const monthly = [
    ['2026-09-01', 3],
    ['2026-10-01', 3],
  ];
  const daily = [
    ['2026-11-25', 3],
    ['2026-11-26', 3.25],
  ];
  assert.deepEqual(applyDailyLatest(monthly, daily), [
    ['2026-09-01', 3],
    ['2026-10-01', 3],
    ['2026-11-01', 3.25],
  ]);
});

test('applyDailyLatest updates existing current month without duplicating', () => {
  const monthly = [
    ['2026-10-01', 3],
    ['2026-11-01', 3],
  ];
  const daily = [['2026-11-26', 3.25]];
  assert.deepEqual(applyDailyLatest(monthly, daily), [
    ['2026-10-01', 3],
    ['2026-11-01', 3.25],
  ]);
});

test('applyDailyLatest ignores older daily data or empty daily array', () => {
  const monthly = [
    ['2026-10-01', 3],
    ['2026-11-01', 3.25],
  ];
  assert.deepEqual(applyDailyLatest(monthly, []), monthly);
  assert.deepEqual(applyDailyLatest(monthly, [['2026-10-31', 3]]), monthly);
});

test('parseEcos parses 8-digit daily dates into YYYY-MM-DD', () => {
  const parsed = parseEcos({
    StatisticSearch: {
      row: [
        { TIME: '20261126', DATA_VALUE: '3.25' },
        { TIME: '20261125', DATA_VALUE: '3' },
      ],
    },
  });
  assert.deepEqual(parsed, [
    ['2026-11-25', 3],
    ['2026-11-26', 3.25],
  ]);
});
