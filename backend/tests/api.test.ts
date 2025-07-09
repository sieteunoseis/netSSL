import request from 'supertest';
import fs from 'fs';
import path from 'path';

// Create a test database path
const testDbPath = path.join(__dirname, '../db/test.db');

// Clean up test database before tests
beforeAll(() => {
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
});

afterAll(() => {
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
});

describe('API Endpoints', () => {
  let app: any;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    // Mock database path for testing
    process.env.DB_PATH = testDbPath;
    
    // Dynamic import to ensure environment variables are set
    const { default: testApp } = await import('../src/server');
    app = testApp;
  });

  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('GET /api/data', () => {
    it('should return empty array initially', async () => {
      const response = await request(app)
        .get('/api/data')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(0);
    });
  });

  describe('POST /api/data', () => {
    it('should create a new connection with valid data', async () => {
      const newConnection = {
        name: 'TestConnection',
        hostname: 'test.example.com',
        username: 'testuser',
        password: 'testpass123',
        version: '12.5'
      };

      const response = await request(app)
        .post('/api/data')
        .send(newConnection)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('message', 'Connection created successfully');
    });

    it('should reject invalid connection data', async () => {
      const invalidConnection = {
        name: 'TestConnection',
        hostname: 'invalid..hostname',
        username: 'testuser',
        password: 'testpass123',
        version: 'invalid'
      };

      const response = await request(app)
        .post('/api/data')
        .send(invalidConnection)
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Validation failed');
      expect(response.body).toHaveProperty('details');
      expect(Array.isArray(response.body.details)).toBe(true);
    });
  });

  describe('GET /api/data/:id', () => {
    it('should return 404 for non-existent connection', async () => {
      await request(app)
        .get('/api/data?id=999')
        .expect(404);
    });

    it('should return 400 for invalid ID format', async () => {
      await request(app)
        .get('/api/data?id=invalid')
        .expect(400);
    });
  });

  describe('404 handling', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await request(app)
        .get('/api/unknown')
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Route not found');
    });
  });
});