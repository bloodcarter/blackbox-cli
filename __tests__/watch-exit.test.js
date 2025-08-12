jest.mock('axios');
const axios = require('axios');
const chalk = require('chalk');

describe('watch exits on definitive agent errors', () => {
  const originalExit = process.exit;
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  let exitCode;
  let outputs;
  let cleanupFiles;

  beforeEach(() => {
    exitCode = undefined;
    outputs = [];
    cleanupFiles = [];
    process.exit = (code) => { exitCode = code; throw new Error('process.exit'); };
    console.log = (...args) => { outputs.push(args.join(' ')); };
    console.error = (...args) => { outputs.push(args.join(' ')); };
  });

  afterEach(() => {
    process.exit = originalExit;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    jest.resetAllMocks();
    const fs = require('fs');
    cleanupFiles.forEach((f) => {
      try { fs.rmSync(f, { force: true }); } catch (_) {}
    });
  });

  test('exits with message on 404 agent', async () => {
    const { watchCommand } = require('..//blackbox-cli.js');

    // Arrange campaign file on the fly
    const fs = require('fs');
    const path = require('path');
    const campaignsDir = path.join(__dirname, '..', '.blackbox-campaigns');
    fs.mkdirSync(campaignsDir, { recursive: true });
    const file = path.join(campaignsDir, 'campaign_test_404.json');
    fs.writeFileSync(file, JSON.stringify({
      campaignId: 'campaign_test_404',
      csvFile: 'tmp.csv',
      agentId: '00000000-0000-0000-0000-000000000000',
      totalCalls: 1,
      successful: 0,
      callIds: ['x'],
      callMapping: {},
      createdAt: new Date().toISOString()
    }, null, 2));
    cleanupFiles.push(file);

    // Mock agent GET 404
    axios.get.mockRejectedValue({ response: { status: 404 } });

    try {
      await watchCommand('campaign_test_404', { apiKey: 'k', apiUrl: 'https://x', refresh: '3' });
    } catch (_) {
      // process.exit throws
    }

    expect(exitCode).toBe(1);
    const joined = outputs.join('\n');
    expect(joined).toMatch(/Agent not found \(404\)/);
    expect(joined).toMatch(/Exiting: The specified agent does not exist/);
  });

  test('exits with message on 401', async () => {
    const { watchCommand } = require('..//blackbox-cli.js');

    // Arrange campaign file
    const fs = require('fs');
    const path = require('path');
    const campaignsDir = path.join(__dirname, '..', '.blackbox-campaigns');
    fs.mkdirSync(campaignsDir, { recursive: true });
    const file = path.join(campaignsDir, 'campaign_test_401.json');
    fs.writeFileSync(file, JSON.stringify({
      campaignId: 'campaign_test_401',
      csvFile: 'tmp.csv',
      agentId: 'agent-1',
      totalCalls: 1,
      successful: 0,
      callIds: ['x'],
      callMapping: {},
      createdAt: new Date().toISOString()
    }, null, 2));
    cleanupFiles.push(file);

    axios.get.mockRejectedValueOnce({ response: { status: 401 } });

    try {
      await watchCommand('campaign_test_401', { apiKey: 'k', apiUrl: 'https://x', refresh: '3' });
    } catch (_) {}

    expect(exitCode).toBe(1);
    const joined = outputs.join('\n');
    expect(joined).toMatch(/Invalid API key \(401\)/);
    expect(joined).toMatch(/Exiting: Invalid API key/);
  });

  test('exits with message on 403', async () => {
    const { watchCommand } = require('..//blackbox-cli.js');

    // Arrange campaign file
    const fs = require('fs');
    const path = require('path');
    const campaignsDir = path.join(__dirname, '..', '.blackbox-campaigns');
    fs.mkdirSync(campaignsDir, { recursive: true });
    const file = path.join(campaignsDir, 'campaign_test_403.json');
    fs.writeFileSync(file, JSON.stringify({
      campaignId: 'campaign_test_403',
      csvFile: 'tmp.csv',
      agentId: 'agent-1',
      totalCalls: 1,
      successful: 0,
      callIds: ['x'],
      callMapping: {},
      createdAt: new Date().toISOString()
    }, null, 2));
    cleanupFiles.push(file);

    axios.get.mockRejectedValueOnce({ response: { status: 403 } });

    try {
      await watchCommand('campaign_test_403', { apiKey: 'k', apiUrl: 'https://x', refresh: '3' });
    } catch (_) {}

    expect(exitCode).toBe(1);
    const joined = outputs.join('\n');
    expect(joined).toMatch(/Forbidden \(403\)/);
    expect(joined).toMatch(/Exiting: Access forbidden/);
  });
});


