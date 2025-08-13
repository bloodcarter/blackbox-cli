const {
  calculateUtilizationPct,
  getConcurrencyLevel,
  getConcurrencyStatusMessage
} = require('../lib/concurrency-utils');

describe('concurrency utils - utilization and levels', () => {
  test('disabled when max <= 0', () => {
    expect(calculateUtilizationPct(0, 0)).toBe(0);
    expect(getConcurrencyLevel(0, 0)).toBe('disabled');
    expect(getConcurrencyStatusMessage(0, 0)).toMatch(/disabled/);
  });

  test('healthy below 70%', () => {
    expect(calculateUtilizationPct(12, 50)).toBe(24);
    expect(getConcurrencyLevel(12, 50)).toBe('healthy');
    expect(getConcurrencyStatusMessage(12, 50)).toMatch(/Healthy/);
  });

  test('warning between 70% and 94%', () => {
    expect(calculateUtilizationPct(35, 50)).toBe(70);
    expect(getConcurrencyLevel(35, 50)).toBe('warning');
    expect(getConcurrencyStatusMessage(35, 50)).toMatch(/Approaching/);

    expect(calculateUtilizationPct(47, 50)).toBe(94);
    expect(getConcurrencyLevel(47, 50)).toBe('warning');
    expect(getConcurrencyStatusMessage(47, 50)).toMatch(/Approaching/);
  });

  test('critical at >=95%', () => {
    expect(calculateUtilizationPct(48, 50)).toBe(96);
    expect(getConcurrencyLevel(48, 50)).toBe('critical');
    expect(getConcurrencyStatusMessage(48, 50)).toMatch(/Near capacity/);
  });

  test('limit reached at 100% or active > max', () => {
    expect(calculateUtilizationPct(50, 50)).toBe(100);
    expect(getConcurrencyLevel(50, 50)).toBe('critical');
    expect(getConcurrencyStatusMessage(50, 50)).toMatch(/limit reached/);

    expect(getConcurrencyLevel(60, 50)).toBe('critical');
    expect(getConcurrencyStatusMessage(60, 50)).toMatch(/limit reached/);
  });
});


