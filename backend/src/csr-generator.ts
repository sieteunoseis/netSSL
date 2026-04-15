import forge from "node-forge";

export interface CSRRequest {
  commonName: string;
  country: string;
  state: string;
  locality: string;
  organization?: string;
  organizationalUnit?: string;
  keySize?: number;
  /**
   * Subject Alternative Names (DNS). The CN is auto-included so callers
   * don't have to remember (modern TLS clients ignore CN and only check SAN).
   */
  sans?: string[];
}

export interface CSRResponse {
  csr: string;
  privateKey: string;
  publicKey: string;
  subject: string;
}

export function generateCSR(request: CSRRequest): CSRResponse {
  try {
    // Set default key size if not provided
    const keySize = request.keySize || 2048;

    // Generate a key pair
    const keys = forge.pki.rsa.generateKeyPair(keySize);

    // Create a certificate signing request (CSR)
    const csr = forge.pki.createCertificationRequest();

    // Set the public key
    csr.publicKey = keys.publicKey;

    // Build the subject attributes
    const subjectAttrs = [{ name: "commonName", value: request.commonName }];

    if (request.country) {
      subjectAttrs.push({ name: "countryName", value: request.country });
    }

    if (request.state) {
      subjectAttrs.push({ name: "stateOrProvinceName", value: request.state });
    }

    if (request.locality) {
      subjectAttrs.push({ name: "localityName", value: request.locality });
    }

    if (request.organization) {
      subjectAttrs.push({
        name: "organizationName",
        value: request.organization,
      });
    }

    if (request.organizationalUnit) {
      subjectAttrs.push({
        name: "organizationalUnitName",
        value: request.organizationalUnit,
      });
    }

    // Set subject attributes
    csr.setSubject(subjectAttrs);

    // Build SAN list — auto-include CN, dedupe, drop empties
    const sanSet = new Set<string>();
    if (request.commonName) sanSet.add(request.commonName.trim());
    for (const san of request.sans || []) {
      const trimmed = String(san || "").trim();
      if (trimmed) sanSet.add(trimmed);
    }

    if (sanSet.size > 0) {
      csr.setAttributes([
        {
          name: "extensionRequest",
          extensions: [
            {
              name: "subjectAltName",
              altNames: Array.from(sanSet).map((value) => ({
                type: 2, // DNS
                value,
              })),
            },
          ],
        },
      ]);
    }

    // Sign the CSR with the private key
    csr.sign(keys.privateKey, forge.md.sha256.create());

    // Convert to PEM format
    const csrPem = forge.pki.certificationRequestToPem(csr);
    const privateKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
    const publicKeyPem = forge.pki.publicKeyToPem(keys.publicKey);

    // Build subject string for display
    const subjectString = subjectAttrs
      .map((attr) => {
        const shortName = getShortName(attr.name);
        return `${shortName}=${attr.value}`;
      })
      .join(", ");

    return {
      csr: csrPem,
      privateKey: privateKeyPem,
      publicKey: publicKeyPem,
      subject: subjectString,
    };
  } catch (error: any) {
    throw new Error(`Failed to generate CSR: ${error.message}`);
  }
}

function getShortName(longName: string): string {
  const nameMap: Record<string, string> = {
    commonName: "CN",
    countryName: "C",
    stateOrProvinceName: "ST",
    localityName: "L",
    organizationName: "O",
    organizationalUnitName: "OU",
  };

  return nameMap[longName] || longName;
}

export interface DecodedCSR {
  commonName: string;
  subject: string;
  sans: string[];
  keyAlgorithm: string;
  keySize: number;
  signatureAlgorithm: string;
}

export function decodeCSR(pem: string): DecodedCSR {
  const csr = forge.pki.certificationRequestFromPem(pem);

  const subjectAttrs = (csr.subject?.attributes || []) as Array<{
    name?: string;
    shortName?: string;
    value: string;
  }>;

  const subject = subjectAttrs
    .map((a) => `${a.shortName || getShortName(a.name || "")}=${a.value}`)
    .join(", ");

  const cn =
    subjectAttrs.find((a) => a.name === "commonName" || a.shortName === "CN")
      ?.value || "";

  // SANs live in the extensionRequest attribute
  const sans: string[] = [];
  const attrs = (csr as any).attributes || [];
  for (const attr of attrs) {
    if (attr.name === "extensionRequest" && Array.isArray(attr.extensions)) {
      for (const ext of attr.extensions) {
        if (ext.name === "subjectAltName" && Array.isArray(ext.altNames)) {
          for (const alt of ext.altNames) {
            if (alt.value) sans.push(String(alt.value));
          }
        }
      }
    }
  }

  // Key info
  const pubKey = csr.publicKey as forge.pki.rsa.PublicKey | undefined;
  const keySize = pubKey?.n ? pubKey.n.bitLength() : 0;
  const keyAlgorithm = pubKey?.n ? "RSA" : "Unknown";

  // signatureOid is present at runtime even though forge's types omit it
  const sigOid = (csr as any).signatureOid as string | undefined;
  const signatureAlgorithm = sigOid
    ? forge.pki.oids[sigOid] || sigOid
    : "Unknown";

  return {
    commonName: cn,
    subject,
    sans,
    keyAlgorithm,
    keySize,
    signatureAlgorithm,
  };
}

export interface ParsedCSRSubject {
  commonName: string;
  country?: string;
  state?: string;
  locality?: string;
  organization?: string;
  organizationalUnit?: string;
  keySize: number;
  sans: string[];
}

/**
 * Extract subject fields + SANs + key size from a PEM CSR so we can regenerate
 * an equivalent CSR with a fresh keypair (used by ISE local-mode renewals to
 * avoid the 409 duplicate-public-key rejection on re-import).
 */
export function parseCSRSubject(pem: string): ParsedCSRSubject {
  const csr = forge.pki.certificationRequestFromPem(pem);

  const subjectAttrs = (csr.subject?.attributes || []) as Array<{
    name?: string;
    shortName?: string;
    value: string;
  }>;

  const findAttr = (names: string[]) =>
    subjectAttrs.find(
      (a) => names.includes(a.name || "") || names.includes(a.shortName || ""),
    )?.value;

  const sans: string[] = [];
  const attrs = (csr as any).attributes || [];
  for (const attr of attrs) {
    if (attr.name === "extensionRequest" && Array.isArray(attr.extensions)) {
      for (const ext of attr.extensions) {
        if (ext.name === "subjectAltName" && Array.isArray(ext.altNames)) {
          for (const alt of ext.altNames) {
            if (alt.value) sans.push(String(alt.value));
          }
        }
      }
    }
  }

  const pubKey = csr.publicKey as forge.pki.rsa.PublicKey | undefined;
  const keySize = pubKey?.n ? pubKey.n.bitLength() : 2048;

  return {
    commonName: findAttr(["commonName", "CN"]) || "",
    country: findAttr(["countryName", "C"]),
    state: findAttr(["stateOrProvinceName", "ST"]),
    locality: findAttr(["localityName", "L"]),
    organization: findAttr(["organizationName", "O"]),
    organizationalUnit: findAttr(["organizationalUnitName", "OU"]),
    keySize,
    sans,
  };
}

export function validateCSRRequest(request: any): string | null {
  if (!request.commonName || typeof request.commonName !== "string") {
    return "Common Name is required and must be a string";
  }

  if (
    !request.country ||
    typeof request.country !== "string" ||
    request.country.length !== 2
  ) {
    return "Country must be a 2-letter country code";
  }

  if (!request.state || typeof request.state !== "string") {
    return "State/Province is required and must be a string";
  }

  if (!request.locality || typeof request.locality !== "string") {
    return "City/Locality is required and must be a string";
  }

  if (
    request.keySize &&
    (typeof request.keySize !== "number" ||
      ![1024, 2048, 4096].includes(request.keySize))
  ) {
    return "Key size must be 1024, 2048, or 4096";
  }

  return null;
}
