import * as https from "https";
import * as http from "http";
import { URL } from "url";
import { DatabaseManager } from "../database";
import { Logger } from "../logger";

export interface VenafiConfig {
  apiUrl: string;
  platform: "cloud" | "tpp";
  apiKey?: string;
  authToken?: string;
  zone?: string;
  username?: string;
  password?: string;
}

export interface VenafiCertificateRequest {
  id: string;
  status: string;
  commonName: string;
  sans?: string[];
}

export interface VenafiCertificateResponse {
  id: string;
  status: string;
  certificate: string;
  chain?: string;
  privateKey?: string;
}

export class VenafiProvider {
  private config: VenafiConfig;

  constructor(config: VenafiConfig) {
    this.config = config;
  }

  static async create(database: DatabaseManager): Promise<VenafiProvider> {
    const settings = await database.getSettingsByProvider("venafi");

    const getSetting = (key: string): string | undefined =>
      settings.find((s) => s.key_name === key)?.key_value;

    const apiUrl = getSetting("VENAFI_API_URL");
    if (!apiUrl) {
      throw new Error("Venafi API URL not configured");
    }

    const platform = (getSetting("VENAFI_PLATFORM") || "cloud") as
      | "cloud"
      | "tpp";
    const zone = getSetting("VENAFI_ZONE");

    let config: VenafiConfig;

    if (platform === "cloud") {
      const apiKey = getSetting("VENAFI_API_KEY");
      if (!apiKey) {
        throw new Error("Venafi API key not configured");
      }
      config = { apiUrl, platform, apiKey, zone };
    } else {
      // TPP — OAuth token auth
      const username = getSetting("VENAFI_USERNAME");
      const password = getSetting("VENAFI_PASSWORD");
      let authToken: string | undefined;

      if (username && password) {
        authToken = await VenafiProvider.authenticateTPP(
          apiUrl,
          username,
          password,
        );
      }

      config = { apiUrl, platform, authToken, zone, username, password };
    }

    Logger.info(`Venafi provider initialized (platform: ${platform})`);
    return new VenafiProvider(config);
  }

  private static async authenticateTPP(
    apiUrl: string,
    username: string,
    password: string,
  ): Promise<string> {
    const body = JSON.stringify({
      username,
      password,
      client_id: "netssl",
      scope: "certificate:manage",
    });

    const response = await VenafiProvider.rawRequest(
      apiUrl,
      "POST",
      "/vedauth/authorize/",
      body,
      {
        "Content-Type": "application/json",
      },
    );

    const data = JSON.parse(response);
    if (!data.access_token) {
      throw new Error(
        "Venafi TPP authentication failed: no access_token returned",
      );
    }

    Logger.info("Venafi TPP authentication successful");
    return data.access_token;
  }

  private static rawRequest(
    baseUrl: string,
    method: string,
    endpoint: string,
    body?: string,
    extraHeaders?: Record<string, string>,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(endpoint, baseUrl);
      const isHttps = parsed.protocol === "https:";

      const options: http.RequestOptions = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
          ...extraHeaders,
        },
      };

      const transport = isHttps ? https : http;

      const req = (transport as typeof https).request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Venafi API error ${res.statusCode}: ${data}`));
          } else {
            resolve(data);
          }
        });
      });

      req.on("error", reject);

      if (body) {
        req.write(body);
      }
      req.end();
    });
  }

  private async apiRequest(
    method: string,
    endpoint: string,
    body?: object,
  ): Promise<any> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.config.platform === "cloud") {
      headers["tppl-api-key"] = this.config.apiKey!;
    } else {
      if (this.config.authToken) {
        headers["Authorization"] = `Bearer ${this.config.authToken}`;
      }
    }

    const bodyStr = body ? JSON.stringify(body) : undefined;
    const raw = await VenafiProvider.rawRequest(
      this.config.apiUrl,
      method,
      endpoint,
      bodyStr,
      headers,
    );

    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  async requestCertificate(
    csr: string,
    commonName: string,
    sans?: string[],
  ): Promise<VenafiCertificateRequest> {
    if (this.config.platform === "cloud") {
      return this.requestCertificateCloud(csr, commonName, sans);
    }
    return this.requestCertificateTPP(csr, commonName, sans);
  }

  private async requestCertificateCloud(
    csr: string,
    commonName: string,
    sans?: string[],
  ): Promise<VenafiCertificateRequest> {
    Logger.info(`Venafi Cloud: requesting certificate for ${commonName}`);

    const payload: any = {
      applicationServerTypeId: "Apache",
      certificationRequest: csr,
      isVaaSGenerated: false,
    };

    if (this.config.zone) {
      payload.certificateIssuingTemplateAliasIdByApplicationId = {};
    }

    if (sans && sans.length > 0) {
      payload.subjectAlternativeNamesByType = {
        dnsNames: sans,
      };
    }

    const response = await this.apiRequest(
      "POST",
      "/outagedetection/v1/certificaterequests",
      payload,
    );

    const id = response.id || response.certificateRequestId || "";
    Logger.info(`Venafi Cloud certificate request submitted, id: ${id}`);

    return {
      id,
      status: response.status || "REQUESTED",
      commonName,
      sans,
    };
  }

  private async requestCertificateTPP(
    csr: string,
    commonName: string,
    sans?: string[],
  ): Promise<VenafiCertificateRequest> {
    Logger.info(`Venafi TPP: requesting certificate for ${commonName}`);

    const payload: any = {
      PKCS10: csr,
      PolicyDN: this.config.zone || "\\VED\\Policy",
      ObjectName: commonName,
    };

    if (sans && sans.length > 0) {
      payload.SubjectAltNames = sans.map((dns) => ({
        TypeName: "DNS Name",
        Name: dns,
      }));
    }

    const response = await this.apiRequest(
      "POST",
      "/Certificates/Request",
      payload,
    );

    const id = response.DN || response.CertificateDN || "";
    Logger.info(`Venafi TPP certificate request submitted, DN: ${id}`);

    return {
      id,
      status: "REQUESTED",
      commonName,
      sans,
    };
  }

  async waitAndRetrieveCertificate(
    requestId: string,
    maxWaitMs: number = 300000,
  ): Promise<VenafiCertificateResponse> {
    const startTime = Date.now();
    const pollInterval = 15000;

    Logger.info(`Venafi: waiting for certificate ${requestId}...`);

    while (Date.now() - startTime < maxWaitMs) {
      try {
        if (this.config.platform === "cloud") {
          const result = await this.retrieveCertificateCloud(requestId);
          if (result) return result;
        } else {
          const result = await this.retrieveCertificateTPP(requestId);
          if (result) return result;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // If not-ready errors, keep polling; otherwise re-throw
        if (!msg.includes("not yet available") && !msg.includes("Pending")) {
          throw err;
        }
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      Logger.info(
        `Venafi: certificate not ready yet (${elapsed}s elapsed), retrying...`,
      );
      await new Promise((r) => setTimeout(r, pollInterval));
    }

    throw new Error(
      `Timeout waiting for Venafi certificate ${requestId} after ${maxWaitMs / 1000}s`,
    );
  }

  private async retrieveCertificateCloud(
    requestId: string,
  ): Promise<VenafiCertificateResponse | null> {
    const response = await this.apiRequest(
      "GET",
      `/outagedetection/v1/certificaterequests/${requestId}/certificate`,
    );

    if (!response || !response.certificate) {
      return null;
    }

    Logger.info(`Venafi Cloud: certificate retrieved for request ${requestId}`);
    return {
      id: requestId,
      status: "ISSUED",
      certificate: response.certificate,
      chain: response.chain,
    };
  }

  private async retrieveCertificateTPP(
    requestId: string,
  ): Promise<VenafiCertificateResponse | null> {
    const payload = {
      CertificateDN: requestId,
      Format: "PEM",
      IncludeChain: true,
    };

    const response = await this.apiRequest(
      "POST",
      "/Certificates/Retrieve",
      payload,
    );

    if (!response || !response.CertificateData) {
      return null;
    }

    Logger.info(`Venafi TPP: certificate retrieved for ${requestId}`);
    return {
      id: requestId,
      status: "ISSUED",
      certificate: response.CertificateData,
      chain: response.ChainData,
    };
  }
}
