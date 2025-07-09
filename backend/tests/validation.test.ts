import { validateConnectionData, sanitizeConnectionData } from '../src/validation';

describe('Validation', () => {
  describe('validateConnectionData', () => {
    it('should validate correct connection data', () => {
      const validData = {
        name: 'TestConnection',
        hostname: 'example.com',
        username: 'testuser',
        password: 'testpass123',
        version: '12.5'
      };

      const result = validateConnectionData(validData);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid hostname', () => {
      const invalidData = {
        name: 'TestConnection',
        hostname: 'invalid..hostname',
        username: 'testuser',
        password: 'testpass123',
        version: '12.5'
      };

      const result = validateConnectionData(invalidData);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Hostname must be a valid FQDN');
    });

    it('should reject missing required fields', () => {
      const incompleteData = {
        name: 'TestConnection'
      };

      const result = validateConnectionData(incompleteData);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject invalid version format', () => {
      const invalidData = {
        name: 'TestConnection',
        hostname: 'example.com',
        username: 'testuser',
        password: 'testpass123',
        version: 'invalid-version'
      };

      const result = validateConnectionData(invalidData);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Version must be a valid decimal number (e.g., 1.0, 2.5, 10.15)');
    });

    it('should accept missing version field', () => {
      const dataWithoutVersion = {
        name: 'TestConnection',
        hostname: 'example.com',
        username: 'testuser',
        password: 'testpass123'
      };

      const result = validateConnectionData(dataWithoutVersion);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept empty version field', () => {
      const dataWithEmptyVersion = {
        name: 'TestConnection',
        hostname: 'example.com',
        username: 'testuser',
        password: 'testpass123',
        version: ''
      };

      const result = validateConnectionData(dataWithEmptyVersion);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('sanitizeConnectionData', () => {
    it('should escape HTML characters', () => {
      const unsafeData = {
        name: '<script>alert("xss")</script>',
        hostname: 'example.com',
        username: 'user&admin',
        password: 'pass"word',
        version: '12.5'
      };

      const sanitized = sanitizeConnectionData(unsafeData);
      expect(sanitized.name).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;');
      expect(sanitized.username).toBe('user&amp;admin');
      expect(sanitized.password).toBe('pass&quot;word');
    });
  });
});