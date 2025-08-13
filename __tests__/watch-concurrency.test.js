jest.mock('axios');
const axios = require('axios');

describe('watch displays concurrency in header', () => {
  const originalExit = process.exit;
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  let outputs;
  let cleanupFiles;

  beforeEach(() => {
    outputs = [];
    cleanupFiles = [];
    process.exit = (code) => { throw new Error('process.exit'); };
    console.log = (...args) => { outputs.push(args.join(' ')); };
    console.error = (...args) => { outputs.push(args.join(' ')); };
    jest.resetAllMocks();
  });

  afterEach(() => {
    process.exit = originalExit;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    jest.useRealTimers();
    // Clean up any created campaign files
    try {
      const fs = require('fs');
      cleanupFiles.forEach((f) => {
        try { fs.rmSync(f, { force: true }); } catch (_) {}
      });
    } catch (_) {}
    delete process.env.BLACKBOX_NON_INTERACTIVE;
  });

  test('renders healthy concurrency line', async () => {
    const { watchCommand } = require('..//blackbox-cli.js');

    // Arrange campaign file
    const fs = require('fs');
    const path = require('path');
    const campaignsDir = path.join(__dirname, '..', '.blackbox-campaigns');
    fs.mkdirSync(campaignsDir, { recursive: true });
    const file = path.join(campaignsDir, 'campaign_watch_healthy.json');
    fs.writeFileSync(file, JSON.stringify({
      campaignId: 'campaign_watch_healthy',
      csvFile: 'tmp.csv',
      agentId: 'agent-1',
      totalCalls: 1,
      successful: 0,
      callIds: ['x'],
      callMapping: {},
      createdAt: new Date().toISOString()
    }, null, 2));
    cleanupFiles.push(file);

    // Mock agent GET 200 and concurrency GET 200
    axios.get.mockResolvedValueOnce({ data: { name: 'Agent', schedule: { timezone: 'UTC' } } });
    axios.get.mockResolvedValueOnce({ data: { active: 12, concurrency: 50 } });
    // Mock callresults search POST to allow update
    axios.post = jest.fn().mockResolvedValueOnce({ data: { results: [], totalPages: 1 } });

    // Run once (non-interactive)
    process.env.BLACKBOX_NON_INTERACTIVE = '1';
    try {
      await watchCommand('campaign_watch_healthy', { apiKey: 'k', apiUrl: 'https://x', refresh: '3' });
    } catch (_) {}

    const joined = outputs.join('\n');
    expect(joined).toMatch(/Concurrency: 12 \/ 50/);
    expect(joined).toMatch(/Healthy utilization|Approaching|Near capacity|limit reached|disabled/);
    delete process.env.BLACKBOX_NON_INTERACTIVE;
  });

  test('renders specific error messages for 401/403', async () => {
    const { watchCommand } = require('..//blackbox-cli.js');

    // Arrange campaign file
    const fs = require('fs');
    const path = require('path');
    const campaignsDir = path.join(__dirname, '..', '.blackbox-campaigns');
    fs.mkdirSync(campaignsDir, { recursive: true });
    const file = path.join(campaignsDir, 'campaign_watch_err.json');
    fs.writeFileSync(file, JSON.stringify({
      campaignId: 'campaign_watch_err',
      csvFile: 'tmp.csv',
      agentId: 'agent-1',
      totalCalls: 1,
      successful: 0,
      callIds: ['x'],
      callMapping: {},
      createdAt: new Date().toISOString()
    }, null, 2));
    cleanupFiles.push(file);

    // Mock agent GET 200
    axios.get.mockResolvedValueOnce({ data: { name: 'Agent', schedule: { timezone: 'UTC' } } });
    // Concurrency GET 401
    axios.get.mockRejectedValueOnce({ response: { status: 401 } });
    // Mock callresults POST
    axios.post = jest.fn().mockResolvedValueOnce({ data: { results: [], totalPages: 1 } });

    process.env.BLACKBOX_NON_INTERACTIVE = '1';
    try {
      await watchCommand('campaign_watch_err', { apiKey: 'k', apiUrl: 'https://x', refresh: '3' });
    } catch (_) {}
    let joined = outputs.join('\n');
    expect(joined).toMatch(/Concurrency: Unauthorized \(401\)/);

    // Reset outputs and test 403
    outputs.length = 0;
    jest.resetAllMocks();
    axios.get.mockResolvedValueOnce({ data: { name: 'Agent', schedule: { timezone: 'UTC' } } });
    axios.get.mockRejectedValueOnce({ response: { status: 403 } });
    axios.post = jest.fn().mockResolvedValueOnce({ data: { results: [], totalPages: 1 } });
    try { await watchCommand('campaign_watch_err', { apiKey: 'k', apiUrl: 'https://x', refresh: '3' }); } catch (_) {}
    joined = outputs.join('\n');
    expect(joined).toMatch(/Concurrency: Forbidden \(403\)/);
    delete process.env.BLACKBOX_NON_INTERACTIVE;
  });

  test('renders alert block when warning or critical', async () => {
    const { watchCommand } = require('..//blackbox-cli.js');
    const fs = require('fs');
    const path = require('path');
    const campaignsDir = path.join(__dirname, '..', '.blackbox-campaigns');
    fs.mkdirSync(campaignsDir, { recursive: true });
    const file = path.join(campaignsDir, 'campaign_watch_alert.json');
    fs.writeFileSync(file, JSON.stringify({
      campaignId: 'campaign_watch_alert',
      csvFile: 'tmp.csv',
      agentId: 'agent-1',
      totalCalls: 1,
      successful: 0,
      callIds: ['x'],
      callMapping: {},
      createdAt: new Date().toISOString()
    }, null, 2));
    cleanupFiles.push(file);

    // Agent OK, concurrency near capacity
    axios.get.mockResolvedValueOnce({ data: { name: 'Agent', schedule: { timezone: 'UTC' } } });
    axios.get.mockResolvedValueOnce({ data: { active: 48, concurrency: 50 } });
    axios.post = jest.fn().mockResolvedValueOnce({ data: { results: [], totalPages: 1 } });

    process.env.BLACKBOX_NON_INTERACTIVE = '1';
    try { await watchCommand('campaign_watch_alert', { apiKey: 'k', apiUrl: 'https://x', refresh: '3' }); } catch (_) {}
    const joined = outputs.join('\n');
    expect(joined).toMatch(/Critical: Near capacity|Concurrency limit reached|Approaching concurrency limit/);
    expect(joined).toMatch(/Contact support@dasha.ai/);
    delete process.env.BLACKBOX_NON_INTERACTIVE;
  });

  test('renders warning header and alert when utilization is high (70-94%)', async () => {
    const { watchCommand } = require('..//blackbox-cli.js');
    const fs = require('fs');
    const path = require('path');
    const campaignsDir = path.join(__dirname, '..', '.blackbox-campaigns');
    fs.mkdirSync(campaignsDir, { recursive: true });
    const file = path.join(campaignsDir, 'campaign_watch_warning.json');
    fs.writeFileSync(file, JSON.stringify({
      campaignId: 'campaign_watch_warning',
      csvFile: 'tmp.csv',
      agentId: 'agent-1',
      totalCalls: 1,
      successful: 0,
      callIds: ['x'],
      callMapping: {},
      createdAt: new Date().toISOString()
    }, null, 2));
    cleanupFiles.push(file);

    // Agent OK, concurrency at 72% (warning)
    axios.get.mockResolvedValueOnce({ data: { name: 'Agent', schedule: { timezone: 'UTC' } } });
    axios.get.mockResolvedValueOnce({ data: { active: 36, concurrency: 50 } });
    axios.post = jest.fn().mockResolvedValueOnce({ data: { results: [], totalPages: 1 } });

    process.env.BLACKBOX_NON_INTERACTIVE = '1';
    try { await watchCommand('campaign_watch_warning', { apiKey: 'k', apiUrl: 'https://x', refresh: '3' }); } catch (_) {}
    const joined = outputs.join('\n');
    // Header contains the status message "Approaching limit."
    expect(joined).toMatch(/Approaching limit\./);
    // Alert block contains the warning title
    expect(joined).toMatch(/Approaching concurrency limit/);
    delete process.env.BLACKBOX_NON_INTERACTIVE;
  });
});


