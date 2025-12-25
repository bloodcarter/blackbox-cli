const BatchCaller = require('../lib/batch-caller');
const axios = require('axios');

// Mock dependencies
jest.mock('axios');
jest.mock('../lib/utils', () => ({
    ...jest.requireActual('../lib/utils'), // Use actual implementation for all except mocked ones
    loadPreviousCampaignEndpoints: jest.fn().mockReturnValue(new Set()),
    writeProcessedCSV: jest.fn(),
}));
jest.mock('../lib/concurrency-service', () => ({
    fetchConcurrency: jest.fn().mockResolvedValue({ active: 0, concurrency: 10 }),
}));


describe('BatchCaller', () => {
    let consoleLogSpy;
    let consoleErrorSpy;

    beforeEach(() => {
        // Spy on console
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        // Reset mocks
        axios.post.mockClear();
        require('../lib/utils').loadPreviousCampaignEndpoints.mockClear();
        require('../lib/utils').writeProcessedCSV.mockClear();
    });

    afterEach(() => {
        // Restore original implementations
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
        jest.clearAllMocks();
    });

    it('should perform a dry run and return exit code 0', async () => {
        // Arrange
        const options = { dryRun: true, apiUrl: 'http://test.com', apiKey: 'test-key', batchSize: 10, delay: 100 };
        const batchCaller = new BatchCaller('calls.csv', 'agent-123', options);

        // Mock the internal method to simplify test
        const mockCalls = [{ endpoint: '+1' }, { endpoint: '+2' }];
        const readCallsSpy = jest.spyOn(BatchCaller.prototype, '_readCallsFromCSV').mockResolvedValue({
            calls: mockCalls,
            allRows: [{ data: { endpoint: '+1' } }, { data: { endpoint: '+2' } }],
        });

        // Act
        const exitCode = await batchCaller.run();

        // Assert
        expect(exitCode).toBe(0);
        expect(readCallsSpy).toHaveBeenCalled();
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Dry run complete. 2 calls validated.'));
        expect(axios.post).not.toHaveBeenCalled();

        readCallsSpy.mockRestore();
    });

    it('should process batches and return exit code 0 on a successful run', async () => {
        // Arrange
        const options = { dryRun: false, apiUrl: 'http://test.com', apiKey: 'test-key', batchSize: 1, delay: 0 };
        const batchCaller = new BatchCaller('calls.csv', 'agent-123', options);

        const mockCalls = [{ endpoint: '+1' }, { endpoint: '+2' }];
        const readCallsSpy = jest.spyOn(BatchCaller.prototype, '_readCallsFromCSV').mockResolvedValue({
            calls: mockCalls,
            allRows: [{data: {endpoint: '+1'}}, {data: {endpoint: '+2'}}],
        });

        axios.post.mockResolvedValue({ data: [{ callId: 'call-1' }, { callId: 'call-2' }] });

        const saveMetaSpy = jest.spyOn(BatchCaller.prototype, '_saveCampaignMetadata').mockImplementation(() => {});

        // Act
        const exitCode = await batchCaller.run();

        // Assert
        expect(exitCode).toBe(0);
        expect(readCallsSpy).toHaveBeenCalled();
        expect(axios.post).toHaveBeenCalledTimes(2); // 2 calls in batches of 1
        expect(saveMetaSpy).toHaveBeenCalled();

        readCallsSpy.mockRestore();
        saveMetaSpy.mockRestore();
    });

    it('should return exit code 1 if API calls fail', async () => {
        // Arrange
        const options = { dryRun: false, apiUrl: 'http://test.com', apiKey: 'test-key', batchSize: 1, delay: 0 };
        const batchCaller = new BatchCaller('calls.csv', 'agent-123', options);

        const mockCalls = [{ endpoint: '+1' }];
        const readCallsSpy = jest.spyOn(BatchCaller.prototype, '_readCallsFromCSV').mockResolvedValue({
            calls: mockCalls,
            allRows: [{data: {endpoint: '+1'}}],
        });

        axios.post.mockRejectedValue({ response: { status: 500 } });

        // Act
        const exitCode = await batchCaller.run();

        // Assert
        expect(exitCode).toBe(1);
        expect(axios.post).toHaveBeenCalledTimes(1);

        readCallsSpy.mockRestore();
    });
});
