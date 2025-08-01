const axios = require('axios');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

class CampaignWatcher {
  constructor(campaign, apiUrl, apiKey) {
    this.campaign = campaign;
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.callStates = new Map();
    this.activityFeed = [];
    this.isPaused = false;
    this.stats = {
      completed: 0,
      running: 0,
      queued: 0,
      pending: 0,
      created: 0,
      failed: 0,
      canceled: 0,
      unknown: 0,
      startTime: Date.now(),
      lastUpdateTime: Date.now()
    };
    this.firstRun = true;
    this.agentName = null;
    // Agent details will be fetched explicitly before first render
  }

  async fetchAgentDetails() {
    try {
      const response = await axios.get(
        `${this.apiUrl}/api/v1/agents/${this.campaign.agentId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (response.data && response.data.name) {
        this.agentName = response.data.name;
      }
    } catch (error) {
      // Silently fail - we'll just use the agent ID
      console.error(chalk.yellow('Note: Could not fetch agent details'));
    }
  }

  async update() {
    if (this.isPaused) return;

    try {
      // Fetch recent calls
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const response = await axios.get(
        `${this.apiUrl}/api/v1/calls/list`,
        {
          params: {
            agentId: this.campaign.agentId,
            fromDate: this.firstRun ? this.campaign.createdAt : fiveMinutesAgo.toISOString(),
            take: 1000
          },
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      // Filter to our campaign and update states
      const updates = [];
      if (response.data && response.data.calls) {
        response.data.calls.forEach(call => {
          if (this.campaign.callIds.includes(call.callId)) {
            const prev = this.callStates.get(call.callId);
            const isNewOrChanged = !prev || prev.status !== call.status;
            
            if (isNewOrChanged) {
              // Try to get endpoint from previous state or call data
              const endpoint = call.endpoint || prev?.endpoint || this.getEndpointFromCampaign(call.callId) || 'Unknown';
              
              updates.push({
                callId: call.callId,
                endpoint: endpoint,
                oldStatus: prev?.status,
                newStatus: call.status,
                timestamp: new Date(),
                duration: this.calculateDuration(call)
              });
            }
            
            // Store call with endpoint info
            this.callStates.set(call.callId, {
              ...call,
              endpoint: call.endpoint || this.callStates.get(call.callId)?.endpoint || this.getEndpointFromCampaign(call.callId)
            });
          }
        });
      }

      // Update activity feed (keep last 10)
      if (updates.length > 0) {
        this.activityFeed.push(...updates);
        this.activityFeed = this.activityFeed.slice(-10);
      }

      // Recalculate stats
      this.recalculateStats();
      
      this.firstRun = false;
      this.stats.lastUpdateTime = Date.now();
    } catch (error) {
      console.error(chalk.red('Error fetching updates:', error.message));
    }
  }

  recalculateStats() {
    // Reset stats
    Object.keys(this.stats).forEach(key => {
      if (typeof this.stats[key] === 'number' && key !== 'startTime' && key !== 'lastUpdateTime') {
        this.stats[key] = 0;
      }
    });

    // Count from known states
    this.callStates.forEach(call => {
      const status = call.status || 'unknown';
      if (this.stats.hasOwnProperty(status)) {
        this.stats[status]++;
      } else {
        this.stats.unknown++;
      }
    });

    // Count unprocessed calls as 'created'
    const processedCount = this.callStates.size;
    const unprocessedCount = this.campaign.totalCalls - processedCount;
    this.stats.created += unprocessedCount;
  }

  calculateDuration(call) {
    if (call.status === 'completed' && call.completedTime && call.createdTime) {
      const start = new Date(call.createdTime);
      const end = new Date(call.completedTime);
      const durationMs = end - start;
      const minutes = Math.floor(durationMs / 60000);
      const seconds = Math.floor((durationMs % 60000) / 1000);
      return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
    }
    return '';
  }

  getProgress() {
    const completed = this.stats.completed;
    const total = this.campaign.totalCalls;
    const percentage = total > 0 ? (completed / total) * 100 : 0;
    return { completed, total, percentage };
  }

  getCallsPerMinute() {
    const elapsed = (Date.now() - this.stats.startTime) / 1000 / 60; // minutes
    const completed = this.stats.completed;
    return elapsed > 0 ? Math.round(completed / elapsed) : 0;
  }

  getEstimatedTimeRemaining() {
    const rate = this.getCallsPerMinute();
    if (rate === 0) return 'calculating...';
    
    const remaining = this.campaign.totalCalls - this.stats.completed;
    const minutes = Math.ceil(remaining / rate);
    
    if (minutes > 60) {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return `~${hours}h ${mins}m`;
    }
    return `~${minutes} minutes`;
  }

  togglePause() {
    this.isPaused = !this.isPaused;
  }

  async exportResults() {
    const results = [];
    
    // Add processed calls
    this.callStates.forEach(call => {
      results.push({
        endpoint: call.endpoint || '',
        status: call.status || 'unknown',
        callId: call.callId,
        createdTime: call.createdTime || '',
        completedTime: call.completedTime || '',
        duration: this.calculateDuration(call),
        inspectorUrl: call.inspectorUrl || ''
      });
    });

    // Add unprocessed calls
    const processedIds = new Set(Array.from(this.callStates.keys()));
    this.campaign.callIds.forEach(callId => {
      if (!processedIds.has(callId)) {
        results.push({
          endpoint: '',
          status: 'created',
          callId: callId,
          createdTime: '',
          completedTime: '',
          duration: '',
          inspectorUrl: ''
        });
      }
    });

    // Convert to CSV
    const headers = ['endpoint', 'status', 'callId', 'createdTime', 'completedTime', 'duration', 'inspectorUrl'];
    const csv = [
      headers.join(','),
      ...results.map(row => headers.map(h => `"${row[h] || ''}"`).join(','))
    ].join('\n');

    const filename = `${this.campaign.campaignId}_results_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    fs.writeFileSync(filename, csv);
    
    return filename;
  }

  isComplete() {
    const progress = this.getProgress();
    return progress.completed >= progress.total;
  }

  getEndpointFromCampaign(callId) {
    // Get endpoint from campaign mapping if available
    if (this.campaign.callMapping && this.campaign.callMapping[callId]) {
      return this.campaign.callMapping[callId].endpoint;
    }
    return null;
  }

  getAgentDisplayName() {
    if (this.agentName) {
      return `${this.agentName} (${this.campaign.agentId})`;
    }
    return this.campaign.agentId;
  }
}

module.exports = CampaignWatcher;