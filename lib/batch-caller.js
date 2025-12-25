const fs = require('fs');
const path = require('path');
const axios = require('axios');
const csv = require('csv-parser');
const cliProgress = require('cli-progress');
const chalk = require('chalk');
const ora = require('ora');
const { fetchConcurrency } = require('./concurrency-service');
const { calculateUtilizationPct, getConcurrencyLevel, getConcurrencyStatusMessage } = require('./concurrency-utils');
const {
    getFatalStatusMessage,
    computePrimaryApiFailure,
    validatePhoneNumber,
    writeProcessedCSV,
    loadPreviousCampaignEndpoints,
    getSystemTimezone,
    parseDeadline,
} = require('./utils');


class Stats {
  constructor() {
    this.total = 0;
    this.successful = 0;
    this.failed = 0;
    this.skipped = 0;
    this.errors = [];
    this.createdCalls = [];
  }
  addError(error) { this.errors.push(error); }
  addCreatedCalls(calls) {
    this.createdCalls.push(...calls);
    this.successful += calls.length;
  }
  addFailedCount(count) { this.failed += count; }
  addSkippedCount(count) { this.skipped += count; }
}

class BatchCaller {
  constructor(csvFile, agentId, options) {
    this.csvFile = csvFile;
    this.agentId = agentId;
    this.options = options;
    this.stats = new Stats();
  }

  async run() {
    this._printConfiguration();
    await this._displayConcurrency();

    try {
      const enrolledEndpoints = loadPreviousCampaignEndpoints(this.csvFile);
      if (enrolledEndpoints.size > 0) {
        console.log(chalk.blue(`ℹ️  Found existing campaign with ${enrolledEndpoints.size} enrolled numbers`));
      }

      const { calls, allRows } = await this._readCallsFromCSV(enrolledEndpoints);

      writeProcessedCSV(this.csvFile, allRows);

      if (this._shouldExitEarly(calls)) {
        return 0; // Success, but no work to do
      }

      if (this.options.dryRun) {
        this._performDryRun(calls);
        return 0;
      }

      await this._processBatches(calls);

      if (this.stats.successful > 0) {
        this._saveCampaignMetadata();
      }

      this._printSummary();
      return this.stats.failed > 0 ? 1 : 0;

    } catch (error) {
      console.error(chalk.red(`\n❌ Fatal error: ${error.message}`));
      if (this.options.verbose && error.stack) {
        console.error(chalk.gray(error.stack));
      }
      return 1; // Failure
    }
  }

  _shouldExitEarly(calls) {
    if (calls.length === 0 && this.stats.errors.length === 0) {
      console.log(chalk.yellow('⚠️  No new calls to process (all numbers already enrolled)'));
      return true;
    }
    if (calls.length === 0 && this.stats.errors.length > 0) {
      console.log(chalk.yellow('⚠️  No valid calls found in CSV file'));
      return true;
    }
    return false;
  }

  _performDryRun(calls) {
    console.log(chalk.green(`\n✓ Dry run complete. ${calls.length} calls validated.`));
    if (this.options.verbose) {
      console.log(chalk.blue('\nSample calls:'));
      calls.slice(0, 3).forEach((call, index) => {
        console.log(chalk.gray(`${index + 1}. ${JSON.stringify(call, null, 2)}`));
      });
    }
  }

  _printConfiguration() {
    console.log(chalk.bold('🚀 BlackBox Batch Call Tool'));
    console.log(chalk.bold('==========================='));
    console.log(`CSV File: ${chalk.cyan(this.csvFile)}`);
    console.log(`Agent ID: ${chalk.cyan(this.agentId)}`);
    console.log(`API URL: ${chalk.cyan(this.options.apiUrl)}`);
    console.log(`Batch Size: ${chalk.cyan(this.options.batchSize)}`);
    console.log(`Rate Limit Delay: ${chalk.cyan(this.options.delay)}ms`);
    if (this.options.dryRun) {
      console.log(chalk.yellow('Mode: DRY RUN (no API calls will be made)'));
    }
    console.log('');
  }

  async _displayConcurrency() {
    try {
      const { active, concurrency } = await fetchConcurrency(this.options.apiUrl, this.options.apiKey);
      const pct = calculateUtilizationPct(active, concurrency);
      const level = getConcurrencyLevel(active, concurrency);
      const message = getConcurrencyStatusMessage(active, concurrency);
      const line = `Concurrency: ${active} / ${concurrency} — ${message} (${pct}%)`;
      const color = { critical: 'red', warning: 'yellow', disabled: 'gray', healthy: 'green' }[level];
      console.log(chalk[color](line));
    } catch (e) {
      const status = e?.response?.status;
      if (status === 401) console.log(chalk.red('Concurrency: Unauthorized (401).'));
      else if (status === 403) console.log(chalk.red('Concurrency: Forbidden (403).'));
      else console.log(chalk.gray('Concurrency: unavailable.'));
    }
  }

  async _readCallsFromCSV(enrolledEndpoints) {
    const spinner = ora('Reading CSV file...').start();
    const calls = [];
    const allRows = [];
    let rowNumber = 0;

    return new Promise((resolve, reject) => {
        fs.createReadStream(this.csvFile)
            .pipe(csv())
            .on('data', (row) => {
                rowNumber++;
                const rowData = { data: row, error: '' };
                try {
                    if (!row.endpoint) throw new Error('Missing required field: endpoint');
                    delete row.error_message;
                    let validatedEndpoint;
                    try {
                        validatedEndpoint = validatePhoneNumber(row.endpoint);
                    } catch (validationError) {
                        console.error(chalk.red(`✗ Error parsing row ${rowNumber}: ${JSON.stringify(row)}`));
                        console.error(chalk.red(`  Reason: ${validationError.message}`));
                        this.stats.addError({ row: rowNumber, data: row, error: validationError.message });
                        rowData.error = validationError.message;
                        allRows.push(rowData);
                        return;
                    }
                    if (enrolledEndpoints.has(validatedEndpoint)) {
                        this.stats.addSkippedCount(1);
                        if (this.options.verbose) console.log(chalk.gray(`  Row ${rowNumber}: ${row.endpoint} → ${validatedEndpoint} (already enrolled)`));
                        allRows.push(rowData);
                        return;
                    }
                    const callRequest = {
                        endpoint: validatedEndpoint,
                        priority: parseInt(row.priority) || 1,
                        callDeadLine: parseDeadline(row.deadline),
                        timezone: row.timezone ? row.timezone.trim() : getSystemTimezone()
                    };
                    const additionalData = {};
                    const knownFields = ['endpoint', 'priority', 'deadline', 'timezone', 'error_message'];
                    for (const [key, value] of Object.entries(row)) {
                        if (!knownFields.includes(key) && value) additionalData[key] = value;
                    }
                    if (Object.keys(additionalData).length > 0) callRequest.additionalData = additionalData;
                    calls.push(callRequest);
                    allRows.push(rowData);
                    if (this.options.verbose) console.log(chalk.gray(`  Row ${rowNumber}: ${callRequest.endpoint}`));
                } catch (error) {
                    console.error(chalk.red(`✗ Error parsing row ${rowNumber}: ${JSON.stringify(row)}`));
                    console.error(chalk.red(`  Reason: ${error.message}`));
                    this.stats.addError({ row: rowNumber, data: row, error: error.message });
                    rowData.error = error.message;
                    allRows.push(rowData);
                }
            })
            .on('end', () => {
                spinner.succeed(chalk.green(`✓ Parsed ${calls.length} valid calls from CSV (${this.stats.skipped} already enrolled)`));
                this.stats.total = rowNumber;
                resolve({ calls, allRows });
            })
            .on('error', (error) => {
                spinner.fail(chalk.red('Failed to read CSV file'));
                reject(error);
            });
    });
  }

  async _sendBatch(batch, batchNumber) {
      try {
        if (this.options.verbose) {
          console.log(chalk.gray(`  Sending batch ${batchNumber} (${batch.length} calls)...`));
        }
        const response = await axios.post(
          `${this.options.apiUrl}/api/v1/calls/bulk?agentId=${this.agentId}`,
          batch,
          {
            headers: {
              'Authorization': `Bearer ${this.options.apiKey}`,
              'Content-Type': 'application/json'
            }
          }
        );
        this.stats.addCreatedCalls(response.data);
        if (this.options.verbose && response.data.length > 0) {
          console.log(chalk.gray(`    Sample call ID: ${response.data[0].callId}`));
        }
        return response.data;
      } catch (error) {
        const status = error?.response?.status;
        this.stats.addError({ batch: batchNumber, status, error: error?.response?.data || error.message || 'Unknown error' });
        this.stats.addFailedCount(batch.length);
        throw error;
      }
  }

  async _processBatches(calls) {
    const { batchSize, delay, verbose } = this.options;
    const batches = [];
    for (let i = 0; i < calls.length; i += batchSize) {
      batches.push(calls.slice(i, i + batchSize));
    }
    console.log(chalk.blue(`\n🔄 Processing ${calls.length} calls in ${batches.length} batches...`));
    const progressBar = new cliProgress.SingleBar({
      format: 'Progress |' + chalk.cyan('{bar}') + '| {percentage}% | {value}/{total} calls | Batch {batch}/{totalBatches}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
    }, cliProgress.Presets.shades_classic);
    progressBar.start(calls.length, 0, { batch: 0, totalBatches: batches.length });

    let earliestScheduleTime = null;

    for (let i = 0; i < batches.length; i++) {
      try {
        const createdCalls = await this._sendBatch(batches[i], i + 1);
        if (createdCalls.length > 0 && createdCalls[0].nextScheduleTime) {
            const scheduleTime = new Date(createdCalls[0].nextScheduleTime);
            if (!earliestScheduleTime || scheduleTime < earliestScheduleTime) {
                earliestScheduleTime = scheduleTime;
            }
        }
        progressBar.update(this.stats.successful + this.stats.failed, { batch: i + 1, totalBatches: batches.length });
        if (i < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      } catch (error) {
        progressBar.update(this.stats.successful + this.stats.failed, { batch: i + 1, totalBatches: batches.length });
        const status = error?.response?.status;
        if ([401, 403, 404].includes(status)) {
          progressBar.stop();
          console.error(chalk.red(`✗ ${getFatalStatusMessage(status, this.agentId)}`));
          if (verbose) {
            console.error(chalk.red(`    Error: ${JSON.stringify(error?.response?.data)}`));
          }
          console.error(chalk.red('Aborting further batches due to a fatal error.'));
          break;
        } else if (verbose) {
          console.error(chalk.yellow(`\n⚠️  Continuing with next batch despite error...`));
        }
      }
    }
    progressBar.stop();

    if (earliestScheduleTime && new Date(earliestScheduleTime) > new Date()) {
        console.log('\n' + chalk.bgBlue.white(' ℹ️  SCHEDULED FOR FUTURE '));
        console.log(chalk.blue(`Calls scheduled for: ${earliestScheduleTime.toLocaleString()} due to agent working hours`));
    }
  }

  _saveCampaignMetadata() {
      const campaignsDir = path.join(process.cwd(), '.blackbox-campaigns');
      const csvBaseName = path.basename(this.csvFile);
      if (!fs.existsSync(campaignsDir)) fs.mkdirSync(campaignsDir, { recursive: true });

      let existingCampaign = null;
      let existingCampaignFile = null;
      const campaignFiles = fs.readdirSync(campaignsDir).filter(f => f.endsWith('.json') && f !== 'last-campaign.json');
      for (const file of campaignFiles) {
          try {
              const data = JSON.parse(fs.readFileSync(path.join(campaignsDir, file), 'utf8'));
              if (data.csvFile === csvBaseName) {
                  existingCampaign = data;
                  existingCampaignFile = file;
                  break;
              }
          } catch (error) { continue; }
      }

      const newCallMapping = {};
      this.stats.createdCalls.forEach(call => {
        newCallMapping[call.callId] = { endpoint: call.endpoint, additionalData: call.additionalData };
      });

      let campaignData, campaignId, campaignFile;
      if (existingCampaign) {
          campaignId = existingCampaign.campaignId;
          campaignFile = path.join(campaignsDir, existingCampaignFile);
          existingCampaign.callIds.push(...this.stats.createdCalls.map(c => c.callId));
          existingCampaign.callMapping = { ...existingCampaign.callMapping, ...newCallMapping };
          existingCampaign.totalCalls = existingCampaign.callIds.length;
          existingCampaign.lastUpdated = new Date().toISOString();
          campaignData = existingCampaign;
          console.log(chalk.green(`\n✓ Updated existing campaign: ${campaignId}`));
      } else {
          campaignId = `campaign_${new Date().toISOString().replace(/[:.]/g, '-')}`;
          campaignFile = path.join(campaignsDir, `${campaignId}.json`);
          campaignData = {
              campaignId,
              csvFile: csvBaseName,
              agentId: this.agentId,
              totalCalls: this.stats.successful,
              callIds: this.stats.createdCalls.map(c => c.callId),
              callMapping: newCallMapping,
              createdAt: new Date().toISOString()
          };
          console.log(chalk.green(`\n✓ Campaign saved: ${campaignId}`));
      }

      fs.writeFileSync(campaignFile, JSON.stringify(campaignData, null, 2));
      const lastCampaignFile = path.join(campaignsDir, 'last-campaign.json');
      fs.writeFileSync(lastCampaignFile, JSON.stringify(campaignData, null, 2));
      console.log(chalk.gray(`  Monitor with: node blackbox-cli.js watch`));
  }

  _printSummary() {
    console.log(chalk.blue('\n📊 Summary'));
    console.log(chalk.blue('=========='));
    console.log(`Total rows in CSV: ${this.stats.total}`);
    if (this.stats.skipped > 0) console.log(chalk.gray(`○ Already enrolled: ${this.stats.skipped}`));
    console.log(chalk.green(`✓ Successfully enrolled: ${this.stats.successful}`));
    const validationErrors = this.stats.errors.filter(e => e.row && e.data);
    console.log(chalk.red(`✗ Failed validation: ${validationErrors.length}`));
    console.log(chalk.red(`✗ Failed API calls: ${this.stats.failed}`));

    if (this.stats.createdCalls.length > 0) {
      console.log(chalk.blue('\n📞 Sample Created Calls:'));
      this.stats.createdCalls.slice(0, 3).forEach((call, index) => {
        console.log(chalk.gray(`${index + 1}. Call ID: ${call.callId}, Endpoint: ${call.endpoint}`));
      });
    }

    if (validationErrors.length > 0) {
      console.log(chalk.red(`\n⚠️  Validation Errors (${validationErrors.length}):`));
      validationErrors.slice(0, 5).forEach((err, index) => {
        console.log(chalk.red(`${index + 1}. Row ${err.row}: ${err.data.endpoint} - ${err.error}`));
      });
      if (validationErrors.length > 5) console.log(chalk.red(`... and ${validationErrors.length - 5} more errors`));
      console.log(chalk.yellow(`\n📝 Error messages have been added to the CSV file`));
    }

    const primary = computePrimaryApiFailure(this.stats.errors);
    if (primary?.status) {
      const hint = getFatalStatusMessage(primary.status, '');
      if (hint) console.log(chalk.red(`Primary failure: ${primary.status} - ${hint}`));
    }
  }
}

module.exports = BatchCaller;
