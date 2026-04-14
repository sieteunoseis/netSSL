import { VenafiProvider } from "../ssl-providers/venafi";
import { DatabaseManager } from "../database";

// Mock DatabaseManager
jest.mock("../database");
// Mock Logger to suppress output during tests
jest.mock("../logger", () => ({
  Logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

const MockedDatabaseManager = DatabaseManager as jest.MockedClass<
  typeof DatabaseManager
>;

describe("VenafiProvider.create()", () => {
  let mockDatabase: jest.Mocked<DatabaseManager>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDatabase = new MockedDatabaseManager(
      "",
      [],
    ) as jest.Mocked<DatabaseManager>;
  });

  it("should throw if VENAFI_API_URL is not configured", async () => {
    mockDatabase.getSettingsByProvider = jest.fn().mockResolvedValue([
      { key_name: "VENAFI_API_KEY", key_value: "test-api-key" },
      { key_name: "VENAFI_PLATFORM", key_value: "cloud" },
    ]);

    await expect(VenafiProvider.create(mockDatabase)).rejects.toThrow(
      "Venafi API URL not configured",
    );
  });

  it("should throw if VENAFI_API_KEY is not configured for cloud platform", async () => {
    mockDatabase.getSettingsByProvider = jest.fn().mockResolvedValue([
      { key_name: "VENAFI_API_URL", key_value: "https://api.venafi.cloud" },
      { key_name: "VENAFI_PLATFORM", key_value: "cloud" },
    ]);

    await expect(VenafiProvider.create(mockDatabase)).rejects.toThrow(
      "Venafi API key not configured",
    );
  });

  it("should create provider with valid cloud settings", async () => {
    mockDatabase.getSettingsByProvider = jest.fn().mockResolvedValue([
      { key_name: "VENAFI_API_URL", key_value: "https://api.venafi.cloud" },
      { key_name: "VENAFI_API_KEY", key_value: "test-api-key" },
      { key_name: "VENAFI_PLATFORM", key_value: "cloud" },
      { key_name: "VENAFI_ZONE", key_value: "Default\\Default" },
    ]);

    const provider = await VenafiProvider.create(mockDatabase);
    expect(provider).toBeInstanceOf(VenafiProvider);
  });
});
