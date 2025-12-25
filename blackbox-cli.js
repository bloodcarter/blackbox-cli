#!/usr/bin/env node

/**
 * BlackBox CLI - Professional batch calling tool
 * 
 * A modern command-line interface for creating batch calls
 * using the BlackBox API from CSV files.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const csv = require('csv-parser');
const { Command } = require('commander');
const cliProgress = require('cli-progress');
const chalk = require('chalk');
const ora = require('ora');
const { fetchConcurrency } = require('./lib/concurrency-service');
const { calculateUtilizationPct, getConcurrencyLevel, getConcurrencyStatusMessage } = require('./lib/concurrency-utils');
const BatchCaller = require('./lib/batch-caller');
const CampaignWatcher = require('./lib/campaign-watcher');

// Initialize commander
const program = new Command();

program
  .name('blackbox-cli')
  .description('Professional CLI tool for BlackBox API batch operations')
  .version('1.0.0');

program
  .command('batch-call <csv-file> <agent-id>')
  .description('Create batch calls from a CSV file')
  .option('-k, --api-key <key>', 'BlackBox API key (overrides BLACKBOX_API_KEY env var)')
  .option('-u, --api-url <url>', 'BlackBox API URL', process.env.BLACKBOX_API_URL || 'https://blackbox.dasha.ai')
  .option('-b, --batch-size <number>', 'Number of calls per batch', '100')
  .option('-d, --delay <ms>', 'Delay between batches in milliseconds', '1000')
  .option('--dry-run', 'Parse CSV and validate without making API calls')
  .option('--verbose', 'Show detailed debug information')
  .action(batchCallCommand);

program
  .command('watch [campaign-id]')
  .description('Monitor a campaign in real-time')
  .option('-k, --api-key <key>', 'BlackBox API key (overrides BLACKBOX_API_KEY env var)')
  .option('-u, --api-url <url>', 'BlackBox API URL', process.env.BLACKBOX_API_URL || 'https://blackbox.dasha.ai')
  .option('-r, --refresh <seconds>', 'Refresh interval in seconds', '3')
  .action(watchCommand);

/**
 * Main batch call command
 */
async function batchCallCommand(csvFile, agentId, options) {
    const apiKey = options.apiKey || process.env.BLACKBOX_API_KEY;
    if (!apiKey) {
        console.error(chalk.red('✗ Error: API key not provided. Use --api-key option or set BLACKBOX_API_KEY environment variable.'));
        process.exit(1);
    }
    if (!fs.existsSync(csvFile)) {
        console.error(chalk.red(`✗ Error: CSV file not found: ${csvFile}`));
        process.exit(1);
    }

    const batchCaller = new BatchCaller(csvFile, agentId, { ...options, apiKey });
    const exitCode = await batchCaller.run();
    process.exit(exitCode);
}

/**
 * Watch command implementation
 */
async function watchCommand(campaignId, options) {
    const apiKey = options.apiKey || process.env.BLACKBOX_API_KEY;
    if (!apiKey) {
        console.error(chalk.red('✗ Error: API key not provided. Use --api-key option or set BLACKBOX_API_KEY environment variable.'));
        process.exit(1);
    }
    const watcher = new CampaignWatcher(campaignId, { ...options, apiKey });
    await watcher.start();
}

// Parse command line arguments when executed directly
if (require.main === module) {
  program.parse(process.argv);
}

// Export functions for testing
module.exports = {
  watchCommand
};