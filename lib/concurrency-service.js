const axios = require('axios');

/**
 * Fetch org-wide concurrency numbers.
 * Returns an object: { active: number, concurrency: number }
 * Throws on non-2xx so callers can render appropriate messages.
 */
async function fetchConcurrency(apiUrl, apiKey, timeoutMs = 2000) {
  const url = `${apiUrl.replace(/\/$/, '')}/api/v1/misc/concurrency`;
  const response = await axios.get(url, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    timeout: timeoutMs
  });
  const data = response && response.data ? response.data : {};
  const active = Number.isFinite(Number(data.active)) ? Number(data.active) : 0;
  const concurrency = Number.isFinite(Number(data.concurrency)) ? Number(data.concurrency) : 0;
  return { active, concurrency };
}

module.exports = { fetchConcurrency };


