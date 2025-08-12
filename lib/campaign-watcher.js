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
    this.agentSchedule = null;
    this.agentTimezone = null;
    this.debug = Boolean(process.env.BLACKBOX_DEBUG && process.env.BLACKBOX_DEBUG !== '0' && process.env.BLACKBOX_DEBUG !== 'false');
    this.agentFetchWarning = null;
    this.agentNotFound = false; // kept for clarity; true only for 404
    this.agentFatalExit = false; // true for 401/403/404
    // Agent details will be fetched explicitly before first render
  }

  // Maps API callStatus values to internal lowercase status keys used in stats
  mapApiStatusToInternal(callStatus) {
    if (!callStatus || typeof callStatus !== 'string') return 'unknown';
    const normalized = callStatus.toLowerCase();
    switch (normalized) {
      case 'completed':
        return 'completed';
      case 'running':
        return 'running';
      case 'queued':
        return 'queued';
      case 'failed':
        return 'failed';
      case 'canceled':
        return 'canceled';
      case 'created':
        return 'created';
      case 'pending':
        return 'pending';
      default:
        return 'unknown';
    }
  }

  // Try to determine a stable campaign additionalData value to filter on
  // We specifically look for the CSV-provided additionalData key: campaignId
  getCampaignAdditionalDataFilter() {
    try {
      const mapping = this.campaign.callMapping || {};
      const uniqueValues = new Set();
      for (const callId of Object.keys(mapping)) {
        const value = mapping[callId]?.additionalData?.campaignId;
        if (value) uniqueValues.add(String(value));
      }
      if (uniqueValues.size === 1) {
        const onlyValue = Array.from(uniqueValues)[0];
        return { 'callAdditionalData.campaignId': onlyValue };
      }
    } catch (_) {
      // ignore
    }
    return null;
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
      
      if (response.data) {
        this.agentFetchWarning = null;
        if (response.data.name) {
          this.agentName = response.data.name;
        }
        if (response.data.schedule) {
          this.agentSchedule = response.data.schedule;
          this.agentTimezone = response.data.schedule.timezone || 'UTC';
          if (this.debug) {
            const keys = Object.keys(this.agentSchedule || {});
            const nonEmpty = keys
              .filter(k => Array.isArray(this.agentSchedule[k]) && this.agentSchedule[k].length > 0)
              .map(k => `${k}(${this.agentSchedule[k].length})`)
              .join(', ');
            console.log(chalk.magenta('[debug] Agent schedule loaded'), {
              timezone: this.agentTimezone,
              keys,
              nonEmptyDays: nonEmpty
            });
          }
        }
      }
    } catch (error) {
      const status = error && error.response && error.response.status;
      if (status === 404) {
        this.agentFetchWarning = 'Agent not found (404).';
        this.agentNotFound = true;
        this.agentFatalExit = true;
      } else if (status === 401) {
        this.agentFetchWarning = 'Invalid API key (401).';
        this.agentFatalExit = true;
      } else if (status === 403) {
        this.agentFetchWarning = 'Forbidden (403).';
        this.agentFatalExit = true;
      } else {
        this.agentFetchWarning = 'Note: Could not fetch agent details';
        this.agentFatalExit = false;
      }
    }
  }

  debugLog(...args) {
    if (this.debug) {
      console.log(chalk.magenta('[debug]'), ...args);
    }
  }

  // Returns the schedule array for a given three-letter day key (e.g., 'Mon'),
  // supporting various API day key styles like 'mon', 'monday', etc.
  getScheduleForDay(dayThreeLetter) {
    if (!this.agentSchedule) return [];

    // Direct exact match (e.g., 'Mon')
    const direct = this.agentSchedule[dayThreeLetter];
    if (Array.isArray(direct)) {
      this.debugLog(`getScheduleForDay match: direct '${dayThreeLetter}' -> len=${direct.length}`);
      return direct;
    }

    // Lowercase three-letter (e.g., 'mon')
    const lowerAbbrev = this.agentSchedule[dayThreeLetter.toLowerCase()];
    if (Array.isArray(lowerAbbrev)) {
      this.debugLog(`getScheduleForDay match: lowerAbbrev '${dayThreeLetter.toLowerCase()}' -> len=${lowerAbbrev.length}`);
      return lowerAbbrev;
    }

    // Full day names (e.g., 'monday')
    const threeToFull = {
      Sun: 'sunday',
      Mon: 'monday',
      Tue: 'tuesday',
      Wed: 'wednesday',
      Thu: 'thursday',
      Fri: 'friday',
      Sat: 'saturday'
    };
    const fullLower = this.agentSchedule[threeToFull[dayThreeLetter]];
    if (Array.isArray(fullLower)) {
      this.debugLog(`getScheduleForDay match: fullLower '${threeToFull[dayThreeLetter]}' -> len=${fullLower.length}`);
      return fullLower;
    }

    this.debugLog(`getScheduleForDay: no match for '${dayThreeLetter}'`);
    return [];
  }

  isWithinSchedule() {
    if (!this.agentSchedule) {
      // No schedule means always available
      return { isOpen: true, nextWindow: null };
    }

    // Get current time in agent's timezone using Intl.DateTimeFormat
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: this.agentTimezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
      weekday: 'short'
    });
    
    const parts = formatter.formatToParts(now);
    const dateParts = {};
    parts.forEach(part => {
      dateParts[part.type] = part.value;
    });
    
    // Get current day of week from formatted weekday
    const weekdayMap = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
    const dayOfWeek = weekdayMap[dateParts.weekday];
    const currentHour = parseInt(dateParts.hour);
    const currentMinute = parseInt(dateParts.minute);
    const currentTimeMinutes = currentHour * 60 + currentMinute;
    
    // Map day index to day name
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const currentDayName = dayNames[dayOfWeek];
    
    // Check if current time falls within any time range for today
    const todaySchedule = this.getScheduleForDay(currentDayName);
    this.debugLog('isWithinSchedule', {
      agentTimezone: this.agentTimezone,
      weekday: dateParts.weekday,
      currentDayName,
      currentHour,
      currentMinute,
      todayScheduleLen: Array.isArray(todaySchedule) ? todaySchedule.length : 0
    });
    
    for (const range of todaySchedule) {
      const startMinutes = range.start.hour * 60 + range.start.minute;
      const endMinutes = range.end.hour * 60 + range.end.minute;
      
      if (currentTimeMinutes >= startMinutes && currentTimeMinutes < endMinutes) {
        return { isOpen: true, nextWindow: null };
      }
    }
    
    // Not within schedule - find next available window
    const nextWindow = this.findNextAvailableWindow(now);
    return { isOpen: false, nextWindow };
  }

  findNextAvailableWindow(currentTime) {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const currentDayIndex = currentTime.getDay();
    const currentTimeMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
    
    // Check remaining windows today
    const todaySchedule = this.getScheduleForDay(dayNames[currentDayIndex]);
    for (const range of todaySchedule) {
      const startMinutes = range.start.hour * 60 + range.start.minute;
      if (startMinutes > currentTimeMinutes) {
        const nextTime = new Date(currentTime);
        nextTime.setHours(range.start.hour, range.start.minute, 0, 0);
        const formatted = this.formatScheduleTime(nextTime, range);
        this.debugLog('findNextAvailableWindow (today)', { formatted });
        return formatted;
      }
    }
    
    // Check next 7 days
    for (let i = 1; i <= 7; i++) {
      const dayIndex = (currentDayIndex + i) % 7;
      const dayName = dayNames[dayIndex];
      const daySchedule = this.getScheduleForDay(dayName);
      
      if (daySchedule.length > 0) {
        const nextTime = new Date(currentTime);
        nextTime.setDate(currentTime.getDate() + i);
        nextTime.setHours(daySchedule[0].start.hour, daySchedule[0].start.minute, 0, 0);
        const formatted = this.formatScheduleTime(nextTime, daySchedule[0]);
        this.debugLog('findNextAvailableWindow (future)', { dayName, inDays: i, formatted });
        return formatted;
      }
    }
    
    return 'No upcoming schedule';
  }

  formatScheduleTime(date, timeRange) {
    const options = { 
      weekday: 'short', 
      hour: 'numeric', 
      minute: '2-digit',
      timeZone: this.agentTimezone,
      timeZoneName: 'short'
    };
    return date.toLocaleString('en-US', options);
  }

  formatScheduleDisplay() {
    if (!this.agentSchedule) {
      return 'Always available';
    }
    
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const scheduleGroups = [];
    
    // Group consecutive days with same schedule
    let currentGroup = null;
    
    for (const day of dayNames) {
      const daySchedule = this.getScheduleForDay(day);
      const scheduleStr = daySchedule.map(range => 
        `${this.formatTime(range.start)}-${this.formatTime(range.end)}`
      ).join(', ');
      
      if (currentGroup && currentGroup.schedule === scheduleStr) {
        currentGroup.days.push(day);
      } else {
        if (currentGroup) {
          scheduleGroups.push(currentGroup);
        }
        currentGroup = { days: [day], schedule: scheduleStr };
      }
    }
    
    if (currentGroup) {
      scheduleGroups.push(currentGroup);
    }
    
    // Format groups
    const formatted = scheduleGroups
      .filter(group => group.schedule !== '')
      .map(group => {
        const dayStr = group.days.length === 1 
          ? group.days[0]
          : `${group.days[0]}-${group.days[group.days.length - 1]}`;
        return `${dayStr} ${group.schedule}`;
      })
      .join(', ');
    
    this.debugLog('formatScheduleDisplay ->', formatted);
    return formatted || 'No schedule defined';
  }
  
  formatTime(timeVal) {
    const hour = timeVal.hour;
    const minute = timeVal.minute;
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minute.toString().padStart(2, '0')}${ampm}`;
  }

  async update() {
    if (this.isPaused) return;

    try {
      // Fetch recent calls using new callresults search API
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const pageSize = 100;
      const baseBody = {
        page: 0,
        size: pageSize,
        fromDate: this.firstRun ? this.campaign.createdAt : fiveMinutesAgo.toISOString(),
        toDate: new Date().toISOString(),
        // Include broad set to track progress in real-time
        callStatuses: ['Completed', 'Failed', 'Running', 'Queued', 'Canceled', 'Created'],
        agentIds: [this.campaign.agentId],
        includeAggregations: false,
        sortDirection: 'Descending',
        sortField: 'completedTime'
      };

      const additionalDataFilter = this.getCampaignAdditionalDataFilter();
      if (additionalDataFilter) {
        baseBody.additionalDataFilters = additionalDataFilter;
      }

      // Paginate through all pages
      const allResults = [];
      let currentPage = 0;
      let totalPages = 1;
      do {
        const requestBody = { ...baseBody, page: currentPage };
        const response = await axios.post(
          `${this.apiUrl}/api/v1/callresults/search`,
          requestBody,
          {
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json'
            }
          }
        );

        const data = response?.data || {};
        const results = Array.isArray(data.results) ? data.results : [];
        allResults.push(...results);

        if (typeof data.totalPages === 'number' && isFinite(data.totalPages)) {
          totalPages = data.totalPages;
        } else if (typeof data.totalCount === 'number' && isFinite(data.totalCount)) {
          totalPages = Math.max(1, Math.ceil(data.totalCount / pageSize));
        } else {
          totalPages = currentPage + 1; // fail-safe to avoid infinite loop
        }
        currentPage++;
      } while (currentPage < totalPages);

      // Filter to our campaign and update states
      const updates = [];
      if (allResults.length > 0) {
        allResults.forEach(result => {
          // Map API result to internal call shape
          const mappedCall = {
            callId: result.callId,
            endpoint: result.endpoint,
            status: this.mapApiStatusToInternal(result.callStatus),
            createdTime: result.createdTime,
            completedTime: result.completedTime,
            durationSeconds: result.durationSeconds,
            serverJobId: result.serverJobId,
            inspectorUrl: result.inspectorUrl || ''
          };

          // Keep strict association with our campaign calls
          if (this.campaign.callIds.includes(mappedCall.callId)) {
            const prev = this.callStates.get(mappedCall.callId);
            const isNewOrChanged = !prev || prev.status !== mappedCall.status;

            if (isNewOrChanged) {
              const endpoint = mappedCall.endpoint || prev?.endpoint || this.getEndpointFromCampaign(mappedCall.callId) || 'Unknown';
              updates.push({
                callId: mappedCall.callId,
                endpoint: endpoint,
                oldStatus: prev?.status,
                newStatus: mappedCall.status,
                timestamp: new Date(),
                durationSeconds: mappedCall.durationSeconds
              });
            }

            // Store call with endpoint info
            this.callStates.set(mappedCall.callId, {
              ...mappedCall,
              endpoint: mappedCall.endpoint || this.callStates.get(mappedCall.callId)?.endpoint || this.getEndpointFromCampaign(mappedCall.callId)
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
        duration: (typeof call.durationSeconds === 'number' && isFinite(call.durationSeconds)) ? call.durationSeconds : '',
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