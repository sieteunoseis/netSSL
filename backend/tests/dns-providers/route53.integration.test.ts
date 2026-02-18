import { Route53Client, ListHostedZonesCommand, ListResourceRecordSetsCommand } from '@aws-sdk/client-route-53';
import { Route53DNSProvider } from '../../src/dns-providers/route53';

/**
 * Integration tests for Route53 DNS provider against LocalStack.
 *
 * Prerequisites:
 *   docker compose -f docker-compose.localstack.yml up -d
 *
 * Run:
 *   cd backend && npm run test:integration
 */

const LOCALSTACK_ENDPOINT = 'http://localhost:4566';
const DUMMY_ACCESS_KEY = 'test';
const DUMMY_SECRET_KEY = 'test';
const TEST_DOMAIN = 'test.example.com';

let testZoneId: string;

// Helper: get the hosted zone ID created by the init script
async function getTestZoneId(): Promise<string> {
  const client = new Route53Client({
    region: 'us-east-1',
    endpoint: LOCALSTACK_ENDPOINT,
    credentials: {
      accessKeyId: DUMMY_ACCESS_KEY,
      secretAccessKey: DUMMY_SECRET_KEY
    }
  });

  const response = await client.send(new ListHostedZonesCommand({}));
  const zone = response.HostedZones?.find(z => z.Name === `${TEST_DOMAIN}.`);

  if (!zone || !zone.Id) {
    throw new Error(
      'Test hosted zone not found. Make sure LocalStack is running:\n' +
      '  docker compose -f docker-compose.localstack.yml up -d'
    );
  }

  // Zone ID comes back as "/hostedzone/XXXXX" — extract just the ID
  return zone.Id.replace('/hostedzone/', '');
}

// Helper: list all record sets in the test zone
async function listRecords(zoneId: string): Promise<any[]> {
  const client = new Route53Client({
    region: 'us-east-1',
    endpoint: LOCALSTACK_ENDPOINT,
    credentials: {
      accessKeyId: DUMMY_ACCESS_KEY,
      secretAccessKey: DUMMY_SECRET_KEY
    }
  });

  const response = await client.send(new ListResourceRecordSetsCommand({
    HostedZoneId: zoneId
  }));

  return response.ResourceRecordSets || [];
}

beforeAll(async () => {
  try {
    testZoneId = await getTestZoneId();
  } catch (error) {
    console.error('\n⚠️  LocalStack not running. Skipping Route53 integration tests.');
    console.error('   Start it with: docker compose -f docker-compose.localstack.yml up -d\n');
    // Set a flag so tests can be skipped gracefully
    testZoneId = '';
  }
});

function skipIfNoLocalStack() {
  if (!testZoneId) {
    return true;
  }
  return false;
}

describe('Route53 DNS Provider - LocalStack Integration', () => {

  describe('createDNSRecord', () => {
    it('should create a TXT record', async () => {
      if (skipIfNoLocalStack()) return;

      const provider = new Route53DNSProvider(
        DUMMY_ACCESS_KEY, DUMMY_SECRET_KEY, testZoneId, TEST_DOMAIN, LOCALSTACK_ENDPOINT
      );

      const record = await provider.createDNSRecord(
        `_acme-challenge.${TEST_DOMAIN}`,
        'test-challenge-value-123',
        'TXT'
      );

      expect(record).toBeDefined();
      expect(record.id).toBe(`TXT__acme-challenge.${TEST_DOMAIN}`);
      expect(record.changeId).toBeTruthy();
      expect(record.recordType).toBe('TXT');

      // Verify the record exists in LocalStack
      const records = await listRecords(testZoneId);
      const txtRecord = records.find(
        r => r.Name === `_acme-challenge.${TEST_DOMAIN}.` && r.Type === 'TXT'
      );
      expect(txtRecord).toBeDefined();
      expect(txtRecord.ResourceRecords[0].Value).toBe('"test-challenge-value-123"');
    });
  });

  describe('deleteDNSRecord', () => {
    it('should create and then delete a TXT record', async () => {
      if (skipIfNoLocalStack()) return;

      const provider = new Route53DNSProvider(
        DUMMY_ACCESS_KEY, DUMMY_SECRET_KEY, testZoneId, TEST_DOMAIN, LOCALSTACK_ENDPOINT
      );

      // Create a record first
      const record = await provider.createDNSRecord(
        `_acme-delete-test.${TEST_DOMAIN}`,
        'delete-me-value',
        'TXT'
      );

      // Verify it exists
      let records = await listRecords(testZoneId);
      let found = records.find(
        r => r.Name === `_acme-delete-test.${TEST_DOMAIN}.` && r.Type === 'TXT'
      );
      expect(found).toBeDefined();

      // Delete it
      await provider.deleteDNSRecord(record.id);

      // Verify it's gone
      records = await listRecords(testZoneId);
      found = records.find(
        r => r.Name === `_acme-delete-test.${TEST_DOMAIN}.` && r.Type === 'TXT'
      );
      expect(found).toBeUndefined();
    });
  });

  describe('UPSERT behavior', () => {
    it('should overwrite existing record with same name', async () => {
      if (skipIfNoLocalStack()) return;

      const provider = new Route53DNSProvider(
        DUMMY_ACCESS_KEY, DUMMY_SECRET_KEY, testZoneId, TEST_DOMAIN, LOCALSTACK_ENDPOINT
      );

      // Create initial record
      await provider.createDNSRecord(
        `_acme-upsert.${TEST_DOMAIN}`,
        'first-value',
        'TXT'
      );

      // Upsert with new value
      await provider.createDNSRecord(
        `_acme-upsert.${TEST_DOMAIN}`,
        'second-value',
        'TXT'
      );

      // Verify the record has the updated value
      const records = await listRecords(testZoneId);
      const txtRecord = records.find(
        r => r.Name === `_acme-upsert.${TEST_DOMAIN}.` && r.Type === 'TXT'
      );
      expect(txtRecord).toBeDefined();
      expect(txtRecord.ResourceRecords[0].Value).toBe('"second-value"');
    });
  });

  describe('provider factory', () => {
    it('should fail with missing credentials', async () => {
      // Create a mock database that returns empty settings
      const mockDatabase = {
        getSettingsByProvider: jest.fn().mockResolvedValue([])
      } as any;

      await expect(
        Route53DNSProvider.create(mockDatabase, TEST_DOMAIN)
      ).rejects.toThrow('AWS Route53 credentials not configured');
    });

    it('should create provider with valid credentials from database', async () => {
      if (skipIfNoLocalStack()) return;

      // Create a mock database that returns test credentials
      const mockDatabase = {
        getSettingsByProvider: jest.fn().mockResolvedValue([
          { key_name: 'AWS_ACCESS_KEY', key_value: DUMMY_ACCESS_KEY },
          { key_name: 'AWS_SECRET_KEY', key_value: DUMMY_SECRET_KEY },
          { key_name: 'AWS_ZONE_ID', key_value: testZoneId }
        ])
      } as any;

      const provider = await Route53DNSProvider.create(mockDatabase, TEST_DOMAIN);
      expect(provider).toBeInstanceOf(Route53DNSProvider);
      expect(mockDatabase.getSettingsByProvider).toHaveBeenCalledWith('route53');
    });
  });
});
