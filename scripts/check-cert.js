#!/usr/bin/env node

// Connects to a host:port and prints the TLS certificate chain being served,
// e.g. npm run check-cert -- guest.automate.builders:8443

const tls = require('tls');

function parseArgs(argv) {
  const args = argv.slice(2).filter((a) => a !== '--');
  if (args.length === 0) {
    console.error('Usage: npm run check-cert -- <host>[:port] [--days <warnDays>]');
    console.error('Example: npm run check-cert -- guest.automate.builders:8443');
    process.exit(1);
  }

  let target = args[0];
  let warnDays = 30;
  const daysFlagIndex = args.indexOf('--days');
  if (daysFlagIndex !== -1 && args[daysFlagIndex + 1]) {
    warnDays = parseInt(args[daysFlagIndex + 1], 10);
  }

  const [host, portStr] = target.split(':');
  const port = portStr ? parseInt(portStr, 10) : 443;
  return { host, port, warnDays };
}

function formatChain(cert) {
  const chain = [];
  let current = cert;
  const seen = new Set();
  while (current && Object.keys(current).length && !seen.has(current.fingerprint256)) {
    seen.add(current.fingerprint256);
    chain.push(current);
    if (current.issuerCertificate && current.issuerCertificate !== current) {
      current = current.issuerCertificate;
    } else {
      break;
    }
  }
  return chain;
}

function printCert(cert, warnDays, isLeaf) {
  const now = new Date();
  const validTo = new Date(cert.valid_to);
  const daysRemaining = Math.round((validTo - now) / 86400000);
  const status = daysRemaining < 0 ? 'EXPIRED' : daysRemaining <= warnDays ? 'EXPIRING SOON' : 'OK';

  console.log(`  Subject:  ${formatName(cert.subject)}`);
  console.log(`  Issuer:   ${formatName(cert.issuer)}`);
  console.log(`  Valid:    ${cert.valid_from} -> ${cert.valid_to} (${daysRemaining}d remaining) [${status}]`);
  console.log(`  Serial:   ${cert.serialNumber}`);
  if (isLeaf && cert.subjectaltname) {
    console.log(`  SANs:     ${cert.subjectaltname}`);
  }
}

function formatName(nameObj) {
  if (!nameObj) return '(none)';
  return Object.entries(nameObj)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
}

function main() {
  const { host, port, warnDays } = parseArgs(process.argv);

  console.log(`Connecting to ${host}:${port} ...\n`);

  const socket = tls.connect(
    {
      host,
      port,
      servername: host,
      rejectUnauthorized: false, // internal/self-signed certs are expected here
      timeout: 10000,
    },
    () => {
      const leaf = socket.getPeerCertificate(true);
      if (!leaf || Object.keys(leaf).length === 0) {
        console.error('No certificate returned by server.');
        socket.end();
        process.exit(1);
      }

      const authorized = socket.authorized;
      console.log(`Chain verified by Node's trust store: ${authorized ? 'yes' : `no (${socket.authorizationError})`}\n`);

      const chain = formatChain(leaf);
      chain.forEach((cert, i) => {
        console.log(`[${i}] ${i === 0 ? 'Leaf' : 'CA'} certificate:`);
        printCert(cert, warnDays, i === 0);
        console.log();
      });

      socket.end();
    },
  );

  socket.on('error', (err) => {
    console.error(`Connection failed: ${err.message}`);
    process.exit(1);
  });

  socket.on('timeout', () => {
    console.error('Connection timed out.');
    socket.destroy();
    process.exit(1);
  });
}

main();
