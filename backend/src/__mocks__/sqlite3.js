// Stub for sqlite3 native module — used in Jest tests where the native binding is unavailable
const Database = jest.fn().mockImplementation(() => ({
  run: jest.fn(),
  get: jest.fn(),
  all: jest.fn(),
  close: jest.fn(),
  serialize: jest.fn((cb) => cb && cb()),
}));

module.exports = { Database, verbose: () => ({ Database }) };
