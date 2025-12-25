const chalk = require('chalk');
jest.mock('axios');

const {
  getFatalStatusMessage,
  computePrimaryApiFailure
} = require('../lib/utils.js');

describe('Fatal status messaging', () => {
  test('maps 404 to agent not found with agent id', () => {
    expect(getFatalStatusMessage(404, 'agent-123')).toMatch(/Agent not found/);
    expect(getFatalStatusMessage(404, 'agent-123')).toMatch(/agent-123/);
  });

  test('maps 401 and 403 to concise messages', () => {
    expect(getFatalStatusMessage(401)).toMatch(/Invalid API key/);
    expect(getFatalStatusMessage(403)).toMatch(/Forbidden/);
    expect(getFatalStatusMessage(500)).toBe('');
  });
});

describe('Primary API failure computation', () => {
  test('returns null when there are mixed statuses', () => {
    const result = computePrimaryApiFailure([
      { status: 404 },
      { status: 401 }
    ]);
    expect(result).toBeNull();
  });

  test('returns the status when all share the same', () => {
    const result = computePrimaryApiFailure([
      { status: 404 },
      { status: 404 },
      { status: 404 }
    ]);
    expect(result).toEqual({ status: 404, count: 3 });
  });
});



