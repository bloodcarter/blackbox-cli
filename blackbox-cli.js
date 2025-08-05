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

// Statistics tracking
class Stats {
  constructor() {
    this.total = 0;
    this.successful = 0;
    this.failed = 0;
    this.skipped = 0;
    this.errors = [];
    this.createdCalls = [];
  }

  addError(error) {
    this.errors.push(error);
  }

  addCreatedCalls(calls) {
    this.createdCalls.push(...calls);
    this.successful += calls.length;
  }

  addFailedCount(count) {
    this.failed += count;
  }
  
  addSkippedCount(count) {
    this.skipped += count;
  }
}

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
 * Validate phone number format
 */
function validatePhoneNumber(phoneNumber) {
  // Remove common formatting characters (spaces, dashes, parentheses)
  const cleaned = phoneNumber.trim().replace(/[\s\-()]/g, '');
  
  // Check if starts with +
  if (!cleaned.startsWith('+')) {
    throw new Error('Phone number must start with + (e.g., +1234567890)');
  }
  
  // Check if contains only + followed by digits
  if (!/^\+\d+$/.test(cleaned)) {
    throw new Error('Phone number must contain only digits after the + sign');
  }
  
  // Check reasonable length (between 7 and 15 digits after +)
  const digitsOnly = cleaned.substring(1);
  if (digitsOnly.length < 7 || digitsOnly.length > 15) {
    throw new Error('Phone number must be between 7 and 15 digits (excluding +)');
  }
  
  return cleaned;
}

/**
 * Write processed CSV with error messages
 */
function writeProcessedCSV(csvFile, allRows) {
  // Get headers from first row, add error_message if not present
  const firstRow = allRows[0];
  const headers = Object.keys(firstRow.data);
  if (!headers.includes('error_message')) {
    headers.push('error_message');
  }
  
  // Build CSV content
  let csvContent = headers.map(h => `"${h}"`).join(',') + '\n';
  
  allRows.forEach(row => {
    const values = headers.map(header => {
      if (header === 'error_message') {
        return `"${row.error || ''}"`;
      }
      const value = row.data[header] || '';
      return `"${String(value).replace(/"/g, '""')}"`;
    });
    csvContent += values.join(',') + '\n';
  });
  
  // Write back to original file
  fs.writeFileSync(csvFile, csvContent);
  
  return csvFile;
}

/**
 * Load previously enrolled endpoints from campaign data
 */
function loadPreviousCampaignEndpoints(csvFile) {
  const campaignsDir = path.join(__dirname, '.blackbox-campaigns');
  const csvBaseName = path.basename(csvFile);
  const enrolledEndpoints = new Set();
  
  if (!fs.existsSync(campaignsDir)) {
    return enrolledEndpoints;
  }
  
  // Look for campaigns that used this CSV file
  const campaignFiles = fs.readdirSync(campaignsDir)
    .filter(f => f.endsWith('.json') && f !== 'last-campaign.json');
  
  for (const campaignFile of campaignFiles) {
    try {
      const campaignData = JSON.parse(
        fs.readFileSync(path.join(campaignsDir, campaignFile), 'utf8')
      );
      
      // Check if this campaign used the same CSV file
      if (campaignData.csvFile === csvBaseName && campaignData.callMapping) {
        // Add all endpoints from this campaign
        Object.values(campaignData.callMapping).forEach(call => {
          enrolledEndpoints.add(call.endpoint);
        });
      }
    } catch (error) {
      // Skip invalid campaign files
      continue;
    }
  }
  
  return enrolledEndpoints;
}

/**
 * Get system timezone
 */
function getSystemTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch (e) {
    return 'UTC';
  }
}

/**
 * Parse deadline string and validate it
 */
function parseDeadline(deadlineStr) {
  if (!deadlineStr) {
    // Default to 24 hours from now
    const deadline = new Date();
    deadline.setHours(deadline.getHours() + 24);
    return deadline.toISOString();
  }
  
  const deadline = new Date(deadlineStr);
  if (isNaN(deadline.getTime())) {
    throw new Error(`Invalid deadline format: ${deadlineStr}`);
  }
  
  const now = new Date();
  const sevenDaysFromNow = new Date();
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
  
  if (deadline < now) {
    throw new Error(`Deadline is in the past: ${deadlineStr}`);
  }
  
  if (deadline > sevenDaysFromNow) {
    throw new Error(`Deadline is more than 7 days in future: ${deadlineStr}`);
  }
  
  return deadline.toISOString();
}

/**
 * Read CSV file and parse calls
 */
async function readCallsFromCSV(filePath, stats, enrolledEndpoints, verbose) {
  const spinner = ora('Reading CSV file...').start();
  
  return new Promise((resolve, reject) => {
    const calls = [];
    const allRows = [];
    let rowNumber = 0;
    let skippedCount = 0;
    
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        rowNumber++;
        const rowData = { data: row, error: '' };
        
        try {
          // Required fields
          if (!row.endpoint) {
            throw new Error('Missing required field: endpoint');
          }
          
          // Clear any existing error_message for revalidation
          delete row.error_message;
          
          // Validate phone number first to get normalized form
          let validatedEndpoint;
          try {
            validatedEndpoint = validatePhoneNumber(row.endpoint);
          } catch (validationError) {
            // If validation fails, we still need to record the error
            console.error(chalk.red(`✗ Error parsing row ${rowNumber}: ${JSON.stringify(row)}`));
            console.error(chalk.red(`  Reason: ${validationError.message}`));
            stats.addError({
              row: rowNumber,
              data: row,
              error: validationError.message
            });
            rowData.error = validationError.message;
            allRows.push(rowData);
            return;
          }
          
          // Check if already enrolled (using normalized number)
          if (enrolledEndpoints.has(validatedEndpoint)) {
            skippedCount++;
            if (verbose) {
              console.log(chalk.gray(`  Row ${rowNumber}: ${row.endpoint} → ${validatedEndpoint} (already enrolled)`));
            }
            allRows.push(rowData);
            return;
          }
          
          // Build call request
          const callRequest = {
            endpoint: validatedEndpoint,
            priority: parseInt(row.priority) || 1,  // Default priority is 1
            callDeadLine: parseDeadline(row.deadline),
            timezone: row.timezone ? row.timezone.trim() : getSystemTimezone()
          };
          
          // Build additionalData from remaining fields
          const additionalData = {};
          const knownFields = ['endpoint', 'priority', 'deadline', 'timezone', 'error_message'];
          
          for (const [key, value] of Object.entries(row)) {
            if (!knownFields.includes(key) && value) {
              additionalData[key] = value;
            }
          }
          
          if (Object.keys(additionalData).length > 0) {
            callRequest.additionalData = additionalData;
          }
          
          calls.push(callRequest);
          allRows.push(rowData);
          
          if (verbose) {
            console.log(chalk.gray(`  Row ${rowNumber}: ${callRequest.endpoint}`));
          }
        } catch (error) {
          console.error(chalk.red(`✗ Error parsing row ${rowNumber}: ${JSON.stringify(row)}`));
          console.error(chalk.red(`  Reason: ${error.message}`));
          stats.addError({
            row: rowNumber,
            data: row,
            error: error.message
          });
          rowData.error = error.message;
          allRows.push(rowData);
        }
      })
      .on('end', () => {
        spinner.succeed(chalk.green(`✓ Parsed ${calls.length} valid calls from CSV (${skippedCount} already enrolled)`));
        stats.total = rowNumber;
        stats.addSkippedCount(skippedCount);
        resolve({ calls, allRows });
      })
      .on('error', (error) => {
        spinner.fail(chalk.red('Failed to read CSV file'));
        reject(error);
      });
  });
}

/**
 * Send batch of calls to BlackBox API
 */
async function sendBatchCalls(batch, batchNumber, apiUrl, apiKey, agentId, stats, verbose) {
  try {
    if (verbose) {
      console.log(chalk.gray(`  Sending batch ${batchNumber} (${batch.length} calls)...`));
    }
    
    const response = await axios.post(
      `${apiUrl}/api/v1/calls/bulk?agentId=${agentId}`,
      batch,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    stats.addCreatedCalls(response.data);
    
    if (verbose && response.data.length > 0) {
      console.log(chalk.gray(`    Sample call ID: ${response.data[0].callId}`));
      console.log(chalk.gray(`    Status: ${response.data[0].status}`));
      console.log(chalk.gray(`    Next schedule: ${response.data[0].nextScheduleTime}`));
    }
    
    return response.data;
  } catch (error) {
    if (verbose) {
      console.error(chalk.red(`  Batch ${batchNumber} failed:`));
      
      if (error.response) {
        console.error(chalk.red(`    Status: ${error.response.status}`));
        console.error(chalk.red(`    Error: ${JSON.stringify(error.response.data)}`));
      } else if (error.request) {
        console.error(chalk.red(`    Error: No response from server`));
      } else {
        console.error(chalk.red(`    Error: ${error.message}`));
      }
    }
    
    stats.addError({
      batch: batchNumber,
      status: error.response?.status,
      error: error.response?.data || error.message
    });
    
    stats.addFailedCount(batch.length);
    throw error;
  }
}

/**
 * Process calls in batches with rate limiting
 */
async function processBatches(calls, options, stats) {
  const { apiUrl, apiKey, agentId, batchSize, delay, verbose } = options;
  const batches = [];
  let scheduledForFuture = false;
  let earliestScheduleTime = null;
  
  // Split calls into batches
  for (let i = 0; i < calls.length; i += batchSize) {
    batches.push(calls.slice(i, i + batchSize));
  }
  
  console.log(chalk.blue(`\n🔄 Processing ${calls.length} calls in ${batches.length} batches...`));
  
  // Create progress bar
  const progressBar = new cliProgress.SingleBar({
    format: 'Progress |' + chalk.cyan('{bar}') + '| {percentage}% | {value}/{total} calls | Batch {batch}/{totalBatches}',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
  }, cliProgress.Presets.shades_classic);
  
  progressBar.start(calls.length, 0, {
    batch: 0,
    totalBatches: batches.length
  });
  
  // Process each batch with rate limiting
  for (let i = 0; i < batches.length; i++) {
    try {
      const createdCalls = await sendBatchCalls(
        batches[i], 
        i + 1, 
        apiUrl, 
        apiKey, 
        agentId, 
        stats,
        verbose
      );
      
      // Check if calls are scheduled for future
      if (createdCalls.length > 0 && createdCalls[0].nextScheduleTime) {
        const scheduleTime = new Date(createdCalls[0].nextScheduleTime);
        const now = new Date();
        const hoursDiff = (scheduleTime - now) / (1000 * 60 * 60);
        
        if (hoursDiff > 1) {
          scheduledForFuture = true;
          if (!earliestScheduleTime || scheduleTime < earliestScheduleTime) {
            earliestScheduleTime = scheduleTime;
          }
        }
      }
      
      progressBar.update(stats.successful + stats.failed, {
        batch: i + 1,
        totalBatches: batches.length
      });
      
      // Rate limiting delay (except for last batch)
      if (i < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } catch (error) {
      progressBar.update(stats.successful + stats.failed, {
        batch: i + 1,
        totalBatches: batches.length
      });
      
      if (verbose) {
        console.error(chalk.yellow(`\n⚠️  Continuing with next batch despite error...`));
      }
    }
  }
  
  progressBar.stop();
  
  // Show warning if calls are scheduled for future
  if (scheduledForFuture && earliestScheduleTime) {
    console.log('\n' + chalk.bgBlue.white(' ℹ️  SCHEDULED FOR FUTURE '));
    console.log(chalk.blue(`Calls scheduled for: ${earliestScheduleTime.toLocaleString()} due to agent working hours`));
    console.log(chalk.gray('Calls will be automatically placed when the agent is available'));
  }
}

/**
 * Print summary report
 */
function printSummary(stats) {
  console.log(chalk.blue('\n📊 Summary'));
  console.log(chalk.blue('=========='));
  console.log(`Total rows in CSV: ${stats.total}`);
  if (stats.skipped > 0) {
    console.log(chalk.gray(`○ Already enrolled: ${stats.skipped}`));
  }
  console.log(chalk.green(`✓ Successfully enrolled: ${stats.successful}`));
  console.log(chalk.red(`✗ Failed validation: ${stats.errors.length}`));
  console.log(chalk.red(`✗ Failed API calls: ${stats.failed}`));
  
  if (stats.createdCalls.length > 0) {
    console.log(chalk.blue('\n📞 Sample Created Calls:'));
    stats.createdCalls.slice(0, 3).forEach((call, index) => {
      console.log(chalk.gray(`${index + 1}. Call ID: ${call.callId}`));
      console.log(chalk.gray(`   Endpoint: ${call.endpoint}`));
      console.log(chalk.gray(`   Schedule: ${call.nextScheduleTime}`));
    });
  }
  
  if (stats.errors.length > 0) {
    console.log(chalk.red(`\n⚠️  Validation Errors (${stats.errors.length}):`));
    stats.errors.slice(0, 5).forEach((err, index) => {
      console.log(chalk.red(`${index + 1}. Row ${err.row}: ${err.data.endpoint} - ${err.error}`));
    });
    if (stats.errors.length > 5) {
      console.log(chalk.red(`... and ${stats.errors.length - 5} more errors`));
    }
    console.log(chalk.yellow(`\n📝 Error messages have been added to the CSV file`));
    console.log(chalk.gray('   Fix the entries and re-run to process them.'));
  }
}

/**
 * Main batch call command
 */
async function batchCallCommand(csvFile, agentId, options) {
  const stats = new Stats();
  
  // Validate API key
  const apiKey = options.apiKey || process.env.BLACKBOX_API_KEY;
  if (!apiKey) {
    console.error(chalk.red('✗ Error: API key not provided. Use --api-key option or set BLACKBOX_API_KEY environment variable.'));
    process.exit(1);
  }
  
  // Validate file exists
  if (!fs.existsSync(csvFile)) {
    console.error(chalk.red(`✗ Error: CSV file not found: ${csvFile}`));
    process.exit(1);
  }
  
  // Parse options
  const batchSize = parseInt(options.batchSize);
  const delay = parseInt(options.delay);
  
  // Print configuration
  console.log(chalk.bold('🚀 BlackBox Batch Call Tool'));
  console.log(chalk.bold('==========================='));
  console.log(`CSV File: ${chalk.cyan(csvFile)}`);
  console.log(`Agent ID: ${chalk.cyan(agentId)}`);
  console.log(`API URL: ${chalk.cyan(options.apiUrl)}`);
  console.log(`Batch Size: ${chalk.cyan(batchSize)}`);
  console.log(`Rate Limit Delay: ${chalk.cyan(delay)}ms`);
  if (options.dryRun) {
    console.log(chalk.yellow('Mode: DRY RUN (no API calls will be made)'));
  }
  console.log('');
  
  try {
    // Load previously enrolled endpoints
    const enrolledEndpoints = loadPreviousCampaignEndpoints(csvFile);
    if (enrolledEndpoints.size > 0) {
      console.log(chalk.blue(`ℹ️  Found existing campaign with ${enrolledEndpoints.size} enrolled numbers`));
    }
    
    // Read and parse CSV
    const { calls, allRows } = await readCallsFromCSV(csvFile, stats, enrolledEndpoints, options.verbose);
    
    // Write processed CSV with error messages
    writeProcessedCSV(csvFile, allRows);
    
    if (calls.length === 0 && stats.errors.length === 0) {
      console.log(chalk.yellow('⚠️  No new calls to process (all numbers already enrolled)'));
      process.exit(0);
    }
    
    if (calls.length === 0 && stats.errors.length > 0) {
      console.log(chalk.yellow('⚠️  No valid calls found in CSV file'));
      process.exit(0);
    }
    
    // Dry run mode - just validate and exit
    if (options.dryRun) {
      console.log(chalk.green(`\n✓ Dry run complete. ${calls.length} calls validated.`));
      if (options.verbose) {
        console.log(chalk.blue('\nSample calls:'));
        calls.slice(0, 3).forEach((call, index) => {
          console.log(chalk.gray(`${index + 1}. ${JSON.stringify(call, null, 2)}`));
        });
      }
      process.exit(0);
    }
    
    // Process batches
    await processBatches(calls, {
      apiUrl: options.apiUrl,
      apiKey,
      agentId,
      batchSize,
      delay,
      verbose: options.verbose
    }, stats);
    
    // Save campaign metadata for watch command
    if (stats.successful > 0) {
      const campaignsDir = path.join(__dirname, '.blackbox-campaigns');
      const csvBaseName = path.basename(csvFile);
      
      // Create campaigns directory if it doesn't exist
      if (!fs.existsSync(campaignsDir)) {
        fs.mkdirSync(campaignsDir, { recursive: true });
      }
      
      // Look for existing campaign for this CSV
      let existingCampaign = null;
      let existingCampaignFile = null;
      
      const campaignFiles = fs.readdirSync(campaignsDir)
        .filter(f => f.endsWith('.json') && f !== 'last-campaign.json');
      
      for (const file of campaignFiles) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(campaignsDir, file), 'utf8'));
          if (data.csvFile === csvBaseName) {
            existingCampaign = data;
            existingCampaignFile = file;
            break;
          }
        } catch (error) {
          continue;
        }
      }
      
      // Create a mapping of callId to call details for new calls
      const newCallMapping = {};
      stats.createdCalls.forEach(call => {
        newCallMapping[call.callId] = {
          endpoint: call.endpoint,
          additionalData: call.additionalData
        };
      });
      
      let campaignData;
      let campaignId;
      let campaignFile;
      
      if (existingCampaign) {
        // Update existing campaign
        campaignId = existingCampaign.campaignId;
        campaignFile = path.join(campaignsDir, existingCampaignFile);
        
        // Merge new calls into existing campaign
        existingCampaign.callIds.push(...stats.createdCalls.map(call => call.callId));
        existingCampaign.callMapping = { ...existingCampaign.callMapping, ...newCallMapping };
        existingCampaign.totalCalls = existingCampaign.callIds.length;
        existingCampaign.successful = existingCampaign.callIds.length;
        existingCampaign.lastUpdated = new Date().toISOString();
        
        campaignData = existingCampaign;
        
        console.log(chalk.green(`\n✓ Updated existing campaign: ${campaignId}`));
        console.log(chalk.gray(`  Added ${stats.successful} new calls (total: ${campaignData.totalCalls})`));
      } else {
        // Create new campaign
        campaignId = `campaign_${new Date().toISOString().replace(/[:.]/g, '-')}`;
        campaignFile = path.join(campaignsDir, `${campaignId}.json`);
        
        campaignData = {
          campaignId,
          csvFile: csvBaseName,
          agentId,
          totalCalls: stats.successful,
          successful: stats.successful,
          callIds: stats.createdCalls.map(call => call.callId),
          callMapping: newCallMapping,
          createdAt: new Date().toISOString()
        };
        
        console.log(chalk.green(`\n✓ Campaign saved: ${campaignId}`));
      }
      
      // Save campaign data
      fs.writeFileSync(campaignFile, JSON.stringify(campaignData, null, 2));
      
      // Also save as last campaign for easy access
      const lastCampaignFile = path.join(campaignsDir, 'last-campaign.json');
      fs.writeFileSync(lastCampaignFile, JSON.stringify(campaignData, null, 2));
      
      console.log(chalk.gray(`  Monitor with: node blackbox-cli.js watch`));
    }
    
    // Print summary
    printSummary(stats);
    
    // Exit with appropriate code
    process.exit(stats.failed > 0 ? 1 : 0);
    
  } catch (error) {
    console.error(chalk.red(`\n❌ Fatal error: ${error.message}`));
    if (options.verbose && error.stack) {
      console.error(chalk.gray(error.stack));
    }
    process.exit(1);
  }
}

/**
 * Watch command implementation
 */
async function watchCommand(campaignId, options) {
  // Validate API key
  const apiKey = options.apiKey || process.env.BLACKBOX_API_KEY;
  if (!apiKey) {
    console.error(chalk.red('✗ Error: API key not provided. Use --api-key option or set BLACKBOX_API_KEY environment variable.'));
    process.exit(1);
  }

  // Load campaign data
  const campaignsDir = path.join(__dirname, '.blackbox-campaigns');
  let campaignFile;
  let campaignData;

  try {
    if (campaignId) {
      // Load specific campaign
      campaignFile = path.join(campaignsDir, `${campaignId}.json`);
    } else {
      // Load last campaign
      campaignFile = path.join(campaignsDir, 'last-campaign.json');
    }

    if (!fs.existsSync(campaignFile)) {
      console.error(chalk.red('✗ Error: Campaign not found. Run a batch-call first to create a campaign.'));
      process.exit(1);
    }

    campaignData = JSON.parse(fs.readFileSync(campaignFile, 'utf8'));
  } catch (error) {
    console.error(chalk.red('✗ Error loading campaign:', error.message));
    process.exit(1);
  }

  // Import CampaignWatcher
  const CampaignWatcher = require('./lib/campaign-watcher');
  const watcher = new CampaignWatcher(campaignData, options.apiUrl, apiKey);

  // Setup keyboard handling
  const readline = require('readline');
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  process.stdin.on('keypress', async (str, key) => {
    if (key.ctrl && key.name === 'c') {
      console.log(chalk.yellow('\n\nExiting...'));
      process.exit(0);
    }
    
    switch (key.name) {
      case 'q':
        console.log(chalk.yellow('\n\nExiting...'));
        process.exit(0);
        break;
      case 'p':
        watcher.togglePause();
        break;
      case 'r':
        await watcher.update();
        render();
        break;
      case 'e':
        const filename = await watcher.exportResults();
        console.log(chalk.green(`\n✓ Results exported to ${filename}`));
        setTimeout(() => render(), 2000);
        break;
    }
  });

  // Render function
  const render = () => {
    console.clear();
    
    // Header
    console.log(chalk.cyan('┌─ Campaign Monitor ──────────────────────────────────────────────────────┐'));
    console.log(chalk.cyan('│') + ` Campaign: ${chalk.bold(campaignData.campaignId)}`.padEnd(73) + chalk.cyan('│'));
    console.log(chalk.cyan('│') + ` Source: ${campaignData.csvFile} (${campaignData.totalCalls} calls)`.padEnd(73) + chalk.cyan('│'));
    console.log(chalk.cyan('│') + ` Agent: ${watcher.getAgentDisplayName()}`.padEnd(73) + chalk.cyan('│'));
    
    const runtime = Math.floor((Date.now() - new Date(campaignData.createdAt).getTime()) / 1000);
    const hours = Math.floor(runtime / 3600);
    const minutes = Math.floor((runtime % 3600) / 60);
    const seconds = runtime % 60;
    const runtimeStr = hours > 0 ? `${hours}h ${minutes}m ${seconds}s` : minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
    
    console.log(chalk.cyan('│') + ` Runtime: ${runtimeStr} | Started: ${new Date(campaignData.createdAt).toLocaleString()}`.padEnd(73) + chalk.cyan('│'));
    console.log(chalk.cyan('└─────────────────────────────────────────────────────────────────────────┘'));
    
    // Schedule Status
    const scheduleStatus = watcher.isWithinSchedule();
    if (!scheduleStatus.isOpen && watcher.agentSchedule) {
      console.log('\n' + chalk.bgYellow.black(' ⚠️  OUTSIDE WORKING HOURS '));
      console.log(chalk.yellow(`Calls paused until: ${scheduleStatus.nextWindow}`));
      console.log(chalk.gray(`Agent schedule: ${watcher.formatScheduleDisplay()} ${watcher.agentTimezone}`));
      console.log(chalk.cyan(`💡 To adjust schedule: Visit https://blackbox.dasha.ai → Agents → Edit Agent → Schedule`));
    }
    
    // Progress
    console.log('\n' + chalk.bold('Overall Progress'));
    console.log('═'.repeat(75));
    
    const progress = watcher.getProgress();
    const barLength = 40;
    const filled = Math.floor((progress.percentage / 100) * barLength);
    const progressBar = '█'.repeat(filled) + '░'.repeat(barLength - filled);
    const progressText = `${progressBar}  ${progress.percentage.toFixed(0)}% (${progress.completed}/${progress.total})`;
    console.log(chalk.green(progressText));
    
    const callsPerMin = watcher.getCallsPerMinute();
    const eta = watcher.getEstimatedTimeRemaining();
    console.log(`Rate: ${callsPerMin} calls/min | Est. remaining: ${eta}`);
    
    // Status breakdown
    console.log('\n' + chalk.bold('Status Breakdown'));
    console.log('═'.repeat(75));
    
    const statuses = [
      { name: 'Completed', key: 'completed', color: 'green', symbol: '✓' },
      { name: 'Running', key: 'running', color: 'blue', symbol: '●' },
      { name: 'Queued', key: 'queued', color: 'yellow', symbol: '○' },
      { name: 'Failed', key: 'failed', color: 'red', symbol: '✗' }
    ];
    
    const maxCount = Math.max(...statuses.map(s => watcher.stats[s.key]));
    
    statuses.forEach(status => {
      const count = watcher.stats[status.key];
      const percentage = campaignData.totalCalls > 0 ? (count / campaignData.totalCalls * 100).toFixed(0) : 0;
      const barLength = 20;
      const filled = maxCount > 0 ? Math.floor((count / maxCount) * barLength) : 0;
      const bar = '█'.repeat(filled).padEnd(barLength);
      
      const line = `${status.name.padEnd(10)} ${chalk[status.color](bar)} ${count.toString().padStart(6)} (${percentage}%)`;
      console.log(line);
    });
    
    // Activity feed
    console.log('\n' + chalk.bold('Live Feed (last 10 calls)'));
    console.log('═'.repeat(75));
    
    if (watcher.activityFeed.length === 0) {
      console.log(chalk.gray('No activity yet...'));
    } else {
      watcher.activityFeed.slice().reverse().forEach(event => {
        const time = event.timestamp.toLocaleTimeString();
        const statusSymbol = event.newStatus === 'completed' ? chalk.green('✓') :
                           event.newStatus === 'running' ? chalk.blue('●') :
                           event.newStatus === 'failed' ? chalk.red('✗') :
                           chalk.gray('○');
        
        let line = `${chalk.gray(time)}  ${statusSymbol}  ${event.endpoint}`;
        
        if (event.newStatus === 'completed' && event.duration) {
          line += chalk.green(` completed (${event.duration})`);
        } else if (event.newStatus === 'running') {
          line += chalk.blue(' started');
        } else if (event.newStatus === 'failed') {
          line += chalk.red(' failed');
        } else {
          line += chalk.gray(` ${event.newStatus}`);
        }
        
        console.log(line);
      });
    }
    
    // Controls
    console.log('\n' + chalk.gray('─'.repeat(75)));
    console.log(chalk.gray('[R]efresh now  [P]ause  [E]xport results  [Q]uit'));
    const pauseStatus = watcher.isPaused ? chalk.yellow('PAUSED') : chalk.green('ON');
    const lastUpdate = new Date(watcher.stats.lastUpdateTime).toLocaleTimeString();
    console.log(chalk.gray(`Auto-refresh: ${pauseStatus} (every ${options.refresh}s) | Last update: ${lastUpdate}`));
  };

  // Initial update and render
  console.log(chalk.yellow('Loading campaign data...'));
  
  // Wait for agent details to be fetched
  await watcher.fetchAgentDetails();
  
  // Then update call data
  await watcher.update();
  render();

  // Set up refresh interval
  const refreshInterval = parseInt(options.refresh) * 1000;
  const interval = setInterval(async () => {
    if (!watcher.isPaused) {
      await watcher.update();
      render();
      
      // Check if campaign is complete
      if (watcher.isComplete()) {
        console.log(chalk.green('\n\n✓ Campaign completed!'));
        clearInterval(interval);
        process.exit(0);
      }
    }
  }, refreshInterval);
}

// Parse command line arguments
program.parse(process.argv);

// Export functions for testing
module.exports = {
  parseDeadline,
  getSystemTimezone,
  validatePhoneNumber,
  writeProcessedCSV,
  loadPreviousCampaignEndpoints,
  readCallsFromCSV,
  Stats
};