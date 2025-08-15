const fs = require('fs');
const path = require('path');

function getFatalStatusMessage(status, agentId) {
    switch (status) {
        case 401:
            return 'Invalid API key (401). Provide a valid key via --api-key or BLACKBOX_API_KEY.';
        case 403:
            return 'Forbidden (403). Your API key does not have access to this agent or resource.';
        case 404:
            return `Agent not found (404). Check the agent ID${agentId ? `: ${agentId}` : ''}.`;
        default:
            return '';
    }
}

function computePrimaryApiFailure(errors) {
    const apiErrors = (errors || []).filter(e => typeof e.status === 'number');
    if (apiErrors.length === 0) return null;
    const statusCounts = new Map();
    for (const err of apiErrors) {
        statusCounts.set(err.status, (statusCounts.get(err.status) || 0) + 1);
    }
    if (statusCounts.size !== 1) return null;
    const [[status, count]] = Array.from(statusCounts.entries());
    return { status, count };
}

function validatePhoneNumber(phoneNumber) {
    const cleaned = phoneNumber.trim().replace(/[\s\-()]/g, '');
    if (!cleaned.startsWith('+')) throw new Error('Phone number must start with + (e.g., +1234567890)');
    if (!/^\+\d+$/.test(cleaned)) throw new Error('Phone number must contain only digits after the + sign');
    const digitsOnly = cleaned.substring(1);
    if (digitsOnly.length < 7 || digitsOnly.length > 15) throw new Error('Phone number must be between 7 and 15 digits (excluding +)');
    return cleaned;
}

function writeProcessedCSV(csvFile, allRows) {
    if (allRows.length === 0) return;
    const firstRow = allRows[0];
    const headers = Object.keys(firstRow.data);
    if (!headers.includes('error_message')) {
        headers.push('error_message');
    }
    let csvContent = headers.map(h => `"${h}"`).join(',') + '\n';
    allRows.forEach(row => {
        const values = headers.map(header => {
            if (header === 'error_message') return `"${row.error || ''}"`;
            const value = row.data[header] || '';
            return `"${String(value).replace(/"/g, '""')}"`;
        });
        csvContent += values.join(',') + '\n';
    });
    fs.writeFileSync(csvFile, csvContent);
    return csvFile;
}

function loadPreviousCampaignEndpoints(csvFile) {
    const campaignsDir = path.join(process.cwd(), '.blackbox-campaigns');
    const csvBaseName = path.basename(csvFile);
    const enrolledEndpoints = new Set();
    if (!fs.existsSync(campaignsDir)) return enrolledEndpoints;
    const campaignFiles = fs.readdirSync(campaignsDir).filter(f => f.endsWith('.json') && f !== 'last-campaign.json');
    for (const campaignFile of campaignFiles) {
        try {
            const campaignData = JSON.parse(fs.readFileSync(path.join(campaignsDir, campaignFile), 'utf8'));
            if (campaignData.csvFile === csvBaseName && campaignData.callMapping) {
                Object.values(campaignData.callMapping).forEach(call => enrolledEndpoints.add(call.endpoint));
            }
        } catch (error) { continue; }
    }
    return enrolledEndpoints;
}

function getSystemTimezone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch (e) { return 'UTC'; }
}

function parseDeadline(deadlineStr) {
    if (!deadlineStr) {
        const deadline = new Date();
        deadline.setHours(deadline.getHours() + 24);
        return deadline.toISOString();
    }
    const deadline = new Date(deadlineStr);
    if (isNaN(deadline.getTime())) throw new Error(`Invalid deadline format: ${deadlineStr}`);
    const now = new Date();
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    if (deadline < now) throw new Error(`Deadline is in the past: ${deadlineStr}`);
    if (deadline > sevenDaysFromNow) throw new Error(`Deadline is more than 7 days in future: ${deadlineStr}`);
    return deadline.toISOString();
}

module.exports = {
    getFatalStatusMessage,
    computePrimaryApiFailure,
    validatePhoneNumber,
    writeProcessedCSV,
    loadPreviousCampaignEndpoints,
    getSystemTimezone,
    parseDeadline,
};
