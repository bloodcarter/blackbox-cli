const fs = require('fs');
const { validatePhoneNumber, parseDeadline, getSystemTimezone, writeProcessedCSV, loadPreviousCampaignEndpoints } = require('../lib/utils.js');

jest.mock('fs');

describe('utils', () => {
    beforeEach(() => {
        // Clear all instances and calls to constructor and all methods:
        fs.writeFileSync.mockClear();
        fs.readFileSync.mockClear();
        fs.existsSync.mockClear();
        fs.readdirSync.mockClear();
    });

    describe('writeProcessedCSV', () => {
        it('should write error messages to the CSV file', () => {
            const allRows = [
                { data: { endpoint: '+123', customer: 'A' }, error: 'Invalid number' },
                { data: { endpoint: '+456', customer: 'B' }, error: '' },
            ];
            writeProcessedCSV('test.csv', allRows);
            expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
            const writtenContent = fs.writeFileSync.mock.calls[0][1];
            expect(writtenContent).toContain('"endpoint","customer","error_message"');
            expect(writtenContent).toContain('"+123","A","Invalid number"');
            expect(writtenContent).toContain('"+456","B",""');
        });
    });

    describe('loadPreviousCampaignEndpoints', () => {
        it('should load endpoints from previous campaign files', () => {
            const campaign1 = { csvFile: 'test.csv', callMapping: { 'c1': { endpoint: '+111' } } };
            const campaign2 = { csvFile: 'another.csv', callMapping: { 'c2': { endpoint: '+222' } } };
            const campaign3 = { csvFile: 'test.csv', callMapping: { 'c3': { endpoint: '+333' } } };

            fs.existsSync.mockReturnValue(true);
            fs.readdirSync.mockReturnValue(['campaign1.json', 'campaign2.json', 'campaign3.json']);
            fs.readFileSync
                .mockReturnValueOnce(JSON.stringify(campaign1))
                .mockReturnValueOnce(JSON.stringify(campaign2))
                .mockReturnValueOnce(JSON.stringify(campaign3));

            const endpoints = loadPreviousCampaignEndpoints('test.csv');
            expect(endpoints.size).toBe(2);
            expect(endpoints.has('+111')).toBe(true);
            expect(endpoints.has('+333')).toBe(true);
            expect(endpoints.has('+222')).toBe(false);
        });

        it('should return an empty set if the campaigns directory does not exist', () => {
            fs.existsSync.mockReturnValue(false);
            const endpoints = loadPreviousCampaignEndpoints('test.csv');
            expect(endpoints.size).toBe(0);
        });
    });

    describe('validatePhoneNumber', () => {
        it('should return the cleaned phone number for valid inputs', () => {
            expect(validatePhoneNumber('+1 (555) 123-4567')).toBe('+15551234567');
            expect(validatePhoneNumber('+44-20-7123-4567')).toBe('+442071234567');
        });

        it('should throw an error for numbers not starting with +', () => {
            expect(() => validatePhoneNumber('15551234567')).toThrow('Phone number must start with +');
        });

        it('should throw an error for numbers with invalid characters', () => {
            expect(() => validatePhoneNumber('+15551234567a')).toThrow('Phone number must contain only digits after the + sign');
        });

        it('should throw an error for numbers that are too short or too long', () => {
            expect(() => validatePhoneNumber('+123456')).toThrow('Phone number must be between 7 and 15 digits');
            expect(() => validatePhoneNumber('+1234567890123456')).toThrow('Phone number must be between 7 and 15 digits');
        });
    });

    describe('parseDeadline', () => {
        it('should return an ISO string for a valid date string', () => {
            const date = new Date();
            date.setHours(date.getHours() + 1);
            const isoString = date.toISOString();
            // Compare dates without milliseconds for stability
            expect(parseDeadline(isoString).substring(0, 19)).toBe(isoString.substring(0, 19));
        });

        it('should return an ISO string 24 hours in the future if no deadline is provided', () => {
            const now = new Date();
            const expectedDeadline = new Date(now.getTime() + 24 * 60 * 60 * 1000);
            const parsed = new Date(parseDeadline(null));
            // Allow a small difference for execution time
            expect(parsed.getTime()).toBeCloseTo(expectedDeadline.getTime(), -2);
        });

        it('should throw an error for an invalid deadline format', () => {
            expect(() => parseDeadline('not a date')).toThrow('Invalid deadline format');
        });

        it('should throw an error for a deadline in the past', () => {
            const pastDate = new Date(Date.now() - 1000).toISOString();
            expect(() => parseDeadline(pastDate)).toThrow('Deadline is in the past');
        });

        it('should throw an error for a deadline more than 7 days in the future', () => {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 8);
            expect(() => parseDeadline(futureDate.toISOString())).toThrow('Deadline is more than 7 days in future');
        });
    });

    describe('getSystemTimezone', () => {
        it('should return a valid timezone string', () => {
            const timezone = getSystemTimezone();
            expect(typeof timezone).toBe('string');
            // A simple check to see if it looks like a timezone
            expect(timezone.length).toBeGreaterThan(2);
            // Check if it's a valid timezone identifier
            expect(() => Intl.DateTimeFormat(undefined, { timeZone: timezone })).not.toThrow();
        });
    });
});
