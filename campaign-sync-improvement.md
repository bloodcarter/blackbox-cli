# Campaign State Synchronization Improvement Plan

## Problem Statement
The watch command currently assumes all originally created calls still exist in the campaign, leading to incorrect progress display when calls are cancelled, expired, or modified externally through the API or other tools. The local campaign state can become out of sync with the server state.

## Current Issues
1. Progress shows incorrect percentages (e.g., 25% when actually all calls are cancelled)
2. Missing calls are assumed to be "created" when they might be cancelled/expired
3. No indication to users when local state differs from server state
4. Total call count never updates after initial campaign creation

## Proposed Solution

### 1. Implement Server Synchronization on Startup
Add a `syncWithServer()` method to CampaignWatcher that:
- Fetches all calls for the campaign from the server on initialization
- Updates the campaign metadata based on actual server data
- Properly categorizes missing calls as cancelled/expired rather than "created"
- Handles pagination for large campaigns

### 2. Update Watch Command Flow
Modify the watch command to:
- Show "Syncing with server..." message during initial load
- Call `syncWithServer()` before the first render
- Display clear warnings when local vs server state differs significantly
- Handle sync errors gracefully with informative messages

### 3. Improve Progress Calculation
- Base progress on actual calls found on server, not original count
- Show separate statistics for:
  - Active calls (queued, running, completed)
  - Cancelled calls
  - Expired calls
- Add a status line: "Original: X calls, Active: Y calls" when counts differ
- Update the progress bar to reflect true completion percentage

### 4. Enhanced Status Display
```
Campaign Overview
================
Original calls: 100
Active calls: 75 (25 cancelled/expired)
Progress: 60% of active calls completed
```

### 5. Handle Edge Cases
- Empty campaigns (all calls cancelled) - show appropriate message
- API errors during sync - fall back to local data with warning
- Very large campaigns - implement pagination support
- Network timeouts - add retry logic with exponential backoff

## Implementation Details

### Code Changes Required

1. **lib/campaign-watcher.js**:
   ```javascript
   async syncWithServer() {
     try {
       // Fetch all calls for this campaign
       const allCalls = await this.fetchAllCampaignCalls();
       
       // Update campaign totals based on server data
       this.updateCampaignTotals(allCalls);
       
       // Mark missing calls as cancelled/expired
       this.reconcileMissingCalls(allCalls);
       
       return true;
     } catch (error) {
       console.warn('Failed to sync with server, using local data');
       return false;
     }
   }
   ```

2. **blackbox-cli.js** (watch command):
   ```javascript
   // Before render loop
   const syncSpinner = ora('Syncing with server...').start();
   const syncSuccess = await watcher.syncWithServer();
   syncSpinner.succeed(syncSuccess ? 'Synced with server' : 'Using local data');
   ```

## Benefits
1. Always shows accurate, real-time campaign status
2. Users immediately see if calls were cancelled/expired
3. Prevents confusion from stale local data
4. Better debugging when issues occur
5. More professional and reliable tool behavior

## Migration Considerations
- Backward compatible with existing campaign files
- No changes to batch-call command needed
- Existing campaigns will sync on next watch command run

## Future Enhancements
- Implement incremental sync for better performance
