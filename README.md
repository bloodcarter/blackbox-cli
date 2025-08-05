# BlackBox CLI - Professional Batch Calling Tool

A modern command-line interface for creating batch calls using the BlackBox API from CSV files and monitoring campaign progress in real-time.

## Quick Start

A simple batch calling tool for BlackBox API. Follow these two steps to launch and monitor your calling campaigns.

### Prerequisites
- Node.js installed on your system
- Your Dasha API key from https://playground.dasha.ai/apikey
- Your agent ID (the UUID from your agent's URL)

### Step 1: Launch a Campaign

```bash
npx git+https://github.com/bloodcarter/blackbox-cli.git batch-call ./sample-calls.csv <AGENT_ID> --api-key <API_KEY>
```

**Where to find your values:**
- `<AGENT_ID>`: The UUID at the end of your agent URL  
  Example: If your URL is `https://blackbox.dasha.ai/agents/edit/18a55759-7fdb-42e1-9c63-8d3b18be850f`  
  Your agent ID is: `18a55759-7fdb-42e1-9c63-8d3b18be850f`
  
- `<API_KEY>`: Get it from https://playground.dasha.ai/apikey

**Example command:**
```bash
npx git+https://github.com/bloodcarter/blackbox-cli.git batch-call ./sample-calls.csv 18a55759-7fdb-42e1-9c63-8d3b18be850f --api-key your-api-key-here
```

### Step 2: Monitor Your Campaign

```bash
npx git+https://github.com/bloodcarter/blackbox-cli.git watch --api-key <API_KEY>
```

This will show real-time progress of your campaign with:
- Live status updates
- Progress bars
- Call success/failure rates
- Interactive controls (press 'E' to export results, 'Q' to quit)

### Sample CSV Format

Create a CSV file with the following format:

```csv
endpoint,priority,deadline,timezone,customerName,campaignId,notes
+15551234567,,,,"Test Call 1","test_batch","First test call"
+15559876543,,,,"Test Call 2","test_batch","Second test call"
+15555551234,,,,"Test Call 3","test_batch","Third test call"
```

**Column descriptions:**
- `endpoint` (required): Phone number to call (must start with +, e.g., +15551234567)
- `priority` (optional): Call priority, defaults to 1
- `deadline` (optional): Call deadline in ISO format, defaults to 24 hours from now
- `timezone` (optional): Timezone for the call, defaults to system timezone
- Any additional columns (like `customerName`, `campaignId`, `notes`) will be added to `additionalData`

**Phone Number Format:**
- Must start with + (e.g., +1234567890)
- Can include spaces, dashes, or parentheses (they'll be stripped automatically)
- Must be 7-15 digits after the country code
- Examples: `+1 555 123 4567`, `+1-555-123-4567`, `+1 (555) 123-4567` all work

## Setup

1. Clone the repository or download the files
2. Install dependencies:
```bash
cd scripts
npm install
```

3. Configure your API key:
```bash
# Option 1: Set environment variable
export BLACKBOX_API_KEY=your-api-key-here

# Option 2: Create .env file
echo "BLACKBOX_API_KEY=your-api-key-here" > .env

# Option 3: Pass directly via command line
node blackbox-cli.js batch-call sample.csv agent_123 --api-key your-api-key-here
```

## Usage

### Option 1: Direct Node.js execution
```bash
node blackbox-cli.js batch-call sample.csv agent_123
node blackbox-cli.js watch
```

### Option 2: Run with npx (no installation needed)
```bash
npx git+https://github.com/bloodcarter/blackbox-cli.git batch-call sample.csv agent_123
npx git+https://github.com/bloodcarter/blackbox-cli.git watch
```

## Features

- 🚀 Professional CLI with built-in help and validation
- 📊 Real-time progress bars and visual feedback
- 🔧 Configurable batch sizes and rate limiting
- 🏃 Dry-run mode for validation without API calls
- 🎨 Beautiful colored output with clear error messages
- ⚙️ Environment variable and .env file support
- 📈 Real-time campaign monitoring with live updates
- 💾 Export campaign results to CSV
- ⌨️ Interactive keyboard controls during monitoring
- 📞 Smart phone number validation with automatic formatting
- 🔄 Campaign continuation - automatically skips already enrolled numbers
- ⏰ Schedule awareness - shows when calls are paused due to agent working hours
- 📝 In-line error reporting in CSV files


## Usage

### Creating Batch Calls

```bash
node blackbox-cli.js batch-call <csv-file> <agent-id>
```

### Monitoring Campaigns

After creating a batch, monitor its progress in real-time:

```bash
# Monitor the most recent campaign
node blackbox-cli.js watch

# Monitor a specific campaign
node blackbox-cli.js watch campaign_20250801_142345
```

### With Options

```bash
# Use a specific API key
node blackbox-cli.js batch-call calls.csv agent_123 --api-key your-key

# Custom batch size and delay
node blackbox-cli.js batch-call calls.csv agent_123 --batch-size 50 --delay 2000

# Dry run to validate CSV without making API calls
node blackbox-cli.js batch-call calls.csv agent_123 --dry-run

# Verbose mode for debugging
node blackbox-cli.js batch-call calls.csv agent_123 --verbose

# Get help
node blackbox-cli.js batch-call --help

# Watch campaign with custom refresh rate
node blackbox-cli.js watch --refresh 5
```

### Batch Call Options

- `-k, --api-key <key>` - BlackBox API key (overrides env var)
- `-u, --api-url <url>` - BlackBox API URL (default: https://blackbox.dasha.ai)
- `-b, --batch-size <number>` - Number of calls per batch (default: 100)
- `-d, --delay <ms>` - Delay between batches in milliseconds (default: 1000)
- `--dry-run` - Parse CSV and validate without making API calls
- `--verbose` - Show detailed debug information

### Watch Command Options

- `-k, --api-key <key>` - BlackBox API key (overrides env var)
- `-u, --api-url <url>` - BlackBox API URL (default: https://blackbox.dasha.ai)
- `-r, --refresh <seconds>` - Refresh interval in seconds (default: 3)

### Watch Command Controls

While monitoring a campaign, use these keyboard shortcuts:
- `R` - Force refresh now
- `P` - Pause/resume auto-refresh
- `E` - Export current results to CSV
- `Q` - Quit monitoring

## CSV Format

The CSV file should have the following columns:
- `endpoint` (required): Phone number to call (must start with +)
- `priority` (optional): Call priority (default: 1)
- `deadline` (optional): Call deadline in ISO format (default: 24 hours from now)
- `timezone` (optional): Timezone for the call (default: system timezone)
- `error_message` (auto-generated): Validation errors appear here after running
- Any other columns will be added to `additionalData`

### Example CSV

```csv
endpoint,priority,deadline,timezone,customerName,campaignId,notes
+15551234567,,,,"Test Call 1","test_batch","First test call"
+15559876543,,,,"Test Call 2","test_batch","Second test call"
+15555551234,,,,"Test Call 3","test_batch","Third test call"
```

## Examples

### Complete Workflow Example

```bash
# 1. Create a batch of calls from CSV
node blackbox-cli.js batch-call sample-calls.csv agent_abc123

# 2. Monitor the campaign progress
node blackbox-cli.js watch

# 3. Export results when complete (or press 'E' during monitoring)
# Results will be saved as campaign_[timestamp]_results.csv
```

### Simple batch call with default settings
```bash
node blackbox-cli.js batch-call sample-calls.csv agent_abc123
```

### Production run with custom settings
```bash
node blackbox-cli.js batch-call production-calls.csv agent_prod_123 \
  --api-key $PROD_API_KEY \
  --batch-size 200 \
  --delay 500 \
  --verbose
```

### Validate CSV file before running
```bash
node blackbox-cli.js batch-call new-campaign.csv agent_123 --dry-run --verbose
```

## Output

### Batch Call Output
- Real-time progress bar showing batch processing
- Color-coded success/error messages
- Summary statistics after completion
- Sample created call IDs for verification
- Detailed error reporting (limited to first 5 errors)
- Campaign ID for monitoring

### Watch Command Display
The watch command shows:
- Campaign overview with runtime and progress
- Overall progress bar with completion percentage
- Status breakdown with visual bars
- Live activity feed showing recent call events
- Real-time metrics (calls per minute, ETA)
- Interactive controls at the bottom

## Testing

Run tests with Jest:
```bash
npm test
```

## Exit Codes

- `0` - Success (all calls created)
- `1` - Failure (some or all calls failed)

## Default Values

- **Priority**: 1 (if not specified in CSV)
- **Deadline**: 24 hours from script execution (if not specified)
- **Timezone**: System timezone (if not specified)
- **API URL**: https://blackbox.dasha.ai
- **Batch Size**: 100 calls per batch
- **Rate Limit Delay**: 1000ms (1 second) between batches

## What's New

### Recent Updates
- **Smart Campaign Continuation**: Re-running the same CSV file will automatically skip already enrolled numbers
- **Phone Number Validation**: Automatic formatting and validation of phone numbers with helpful error messages
- **Schedule Awareness**: The watch command now shows when calls are paused due to agent working hours
- **In-line Error Reporting**: Validation errors are written directly to your CSV file for easy fixing
- **Extended Default Deadline**: Changed from 10 seconds to 24 hours for more practical scheduling

### Error Handling
When phone numbers fail validation, the tool will:
1. Add an `error_message` column to your CSV
2. Continue processing valid numbers
3. Show which numbers failed and why
4. Allow you to fix and re-run - fixed numbers will be processed automatically

### Schedule Display
The watch command will show:
- Current agent schedule and timezone
- Warning when outside working hours
- Next available calling window
- Link to adjust schedule in the BlackBox UI
