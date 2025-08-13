jest.mock('axios');
const axios = require('axios');

const { fetchConcurrency } = require('../lib/concurrency-service');

describe('fetchConcurrency', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('returns normalized numbers on success', async () => {
    axios.get.mockResolvedValueOnce({ data: { active: 12, concurrency: 50 } });
    const result = await fetchConcurrency('https://api', 'k');
    expect(result).toEqual({ active: 12, concurrency: 50 });
  });

  test('coerces non-numeric values to 0', async () => {
    axios.get.mockResolvedValueOnce({ data: { active: 'x', concurrency: null } });
    const result = await fetchConcurrency('https://api', 'k');
    expect(result).toEqual({ active: 0, concurrency: 0 });
  });

  test('throws on 401', async () => {
    axios.get.mockRejectedValueOnce({ response: { status: 401 } });
    await expect(fetchConcurrency('https://api', 'k')).rejects.toBeTruthy();
  });

  test('throws on network error', async () => {
    axios.get.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(fetchConcurrency('https://api', 'k')).rejects.toBeTruthy();
  });
});


