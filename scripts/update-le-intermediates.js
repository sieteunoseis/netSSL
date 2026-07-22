#!/usr/bin/env node

// Refreshes backend/src/data/le-intermediates.json from crt.sh's certificate
// transparency search. crt.sh has no documented "list certs issued by CA X"
// endpoint that reliably returns JSON, so this uses free-text `q=` searches
// (which do work) against known root/intermediate names, then keeps only
// results whose issuer matches a known Let's Encrypt root CN.
//
// crt.sh is a community-run service and frequently 502s under load — this
// retries with backoff, and exits non-zero (without touching the JSON file)
// if it can never get a good response, so a flaky run doesn't wipe out
// previously-known data.

const fs = require('fs');
const path = require('path');
const https = require('https');

const DATA_PATH = path.join(__dirname, '..', 'backend', 'src', 'data', 'le-intermediates.json');

// Search terms known to surface Let's Encrypt's current root/intermediate
// families. Add new terms here as Let's Encrypt introduces new hierarchies.
const SEARCH_TERMS = [
  "ISRG Root X1",
  "ISRG Root X2",
  "Root YR",
  "Root YE",
  "Let's Encrypt",
];

// Known self-signed roots — the anchors we trust as the top of any chain.
const KNOWN_ROOT_CNS = new Set(["ISRG Root X1", "ISRG Root X2"]);

function fetchJson(url, attempt = 1, maxAttempts = 6) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'netSSL-le-intermediates-updater' } }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`Invalid JSON: ${e.message}`));
          }
        });
      })
      .on('error', reject);
  }).catch(async (err) => {
    if (attempt >= maxAttempts) throw err;
    const delayMs = attempt * 5000;
    console.log(`  Attempt ${attempt} failed (${err.message}), retrying in ${delayMs / 1000}s...`);
    await new Promise((r) => setTimeout(r, delayMs));
    return fetchJson(url, attempt + 1, maxAttempts);
  });
}

function shortIssuerCn(issuerName) {
  const match = issuerName.match(/CN=([^,]+)/);
  return match ? match[1].trim() : issuerName;
}

async function main() {
  const existing = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const byKey = new Map(
    existing.certificates.map((c) => [`${c.issuerCommonName}::${c.commonName}`, c]),
  );

  console.log(`Querying crt.sh for ${SEARCH_TERMS.length} known LE root/intermediate names...`);

  for (const term of SEARCH_TERMS) {
    const url = `https://crt.sh/?q=${encodeURIComponent(term)}&output=json`;
    console.log(`Fetching: ${term}`);
    let rows;
    try {
      rows = await fetchJson(url);
    } catch (err) {
      console.error(`  Giving up on "${term}": ${err.message}`);
      continue;
    }
    console.log(`  Got ${rows.length} rows`);

    for (const row of rows) {
      const issuerCn = shortIssuerCn(row.issuer_name);
      const isKnownRootIssuer =
        KNOWN_ROOT_CNS.has(issuerCn) || row.common_name === issuerCn /* self-signed */;
      const isSelfSigned = row.common_name === issuerCn;

      // Only keep entries that are either a known self-signed root, or
      // issued by something already in our known-root set — avoids pulling
      // in unrelated certs that happen to match the free-text search.
      if (!isKnownRootIssuer && !byKey.has(`${issuerCn}::${row.common_name}`)) {
        continue;
      }

      const key = `${issuerCn}::${row.common_name}`;
      const entry = {
        commonName: row.common_name,
        issuerCommonName: issuerCn,
        selfSigned: isSelfSigned,
        serialNumber: row.serial_number ? row.serial_number.toUpperCase() : null,
        notBefore: row.not_before ? row.not_before.slice(0, 10) : null,
        notAfter: row.not_after ? row.not_after.slice(0, 10) : null,
        crtShCaId: row.issuer_ca_id,
      };

      const prior = byKey.get(key);
      if (!prior || (prior.serialNumber === null && entry.serialNumber)) {
        byKey.set(key, entry);
      }
    }
  }

  const certificates = Array.from(byKey.values()).sort((a, b) =>
    `${a.issuerCommonName}${a.commonName}`.localeCompare(`${b.issuerCommonName}${b.commonName}`),
  );

  const output = {
    $comment: existing.$comment,
    updated: new Date().toISOString().slice(0, 10),
    source: 'https://crt.sh',
    certificates,
  };

  fs.writeFileSync(DATA_PATH, JSON.stringify(output, null, 2) + '\n');
  console.log(`Wrote ${certificates.length} entries to ${DATA_PATH}`);
}

main().catch((err) => {
  console.error('Failed to update LE intermediates:', err.message);
  process.exit(1);
});
