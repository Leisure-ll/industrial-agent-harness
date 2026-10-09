// Builds a throwaway self-signed localhost TLS certificate at test runtime.
// The previously committed fixture certificate (PR #51) carried a two-day
// validity window and broke every CI platform at once when it expired, so no
// static TLS material ships in the repository anymore. Encoding is plain DER
// with node:crypto only — no OpenSSL binary and no registry dependency.
const crypto = require('node:crypto');

// 1.2.840.113549.1.1.11 (sha256WithRSAEncryption), 2.5.4.3 (commonName) and
// 2.5.29.17 (subjectAltName) pre-encoded as base-128 OID content bytes.
const SHA256_WITH_RSA = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b];
const COMMON_NAME = [0x55, 0x04, 0x03];
const SUBJECT_ALT_NAME = [0x55, 0x1d, 0x11];

function tlv(tag, ...parts) {
  const body = [];
  for (const part of parts) {
    if (Array.isArray(part)) body.push(...part);
    else if (Buffer.isBuffer(part)) body.push(...part);
    else body.push(part);
  }
  const length =
    body.length < 0x80
      ? [body.length]
      : (() => {
          const bytes = [];
          for (let v = body.length; v > 0; v >>= 8) bytes.unshift(v & 0xff);
          return [0x80 | bytes.length, ...bytes];
        })();
  return [tag, ...length, ...body];
}

function commonName(value) {
  return tlv(
    0x30,
    tlv(0x31, tlv(0x30, tlv(0x06, COMMON_NAME), tlv(0x0c, [...Buffer.from(value, 'utf8')]))),
  );
}

function utcTime(date) {
  const pair = n => String(n).padStart(2, '0');
  const text =
    `${pair(date.getUTCFullYear() % 100)}${pair(date.getUTCMonth() + 1)}${pair(date.getUTCDate())}` +
    `${pair(date.getUTCHours())}${pair(date.getUTCMinutes())}${pair(date.getUTCSeconds())}Z`;
  return tlv(0x17, [...Buffer.from(text, 'ascii')]);
}

function toPem(label, der) {
  const base64 = der
    .toString('base64')
    .match(/.{1,64}/g)
    .join('\n');
  return `-----BEGIN ${label}-----\n${base64}\n-----END ${label}-----\n`;
}

function createLocalhostCertificate(cn = 'Harness audit localhost') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const now = Date.now();
  // One day of skew margin on both ends; the material lives only for this run.
  const notBefore = new Date(now - 24 * 60 * 60 * 1000);
  const notAfter = new Date(now + 24 * 60 * 60 * 1000);
  const name = commonName(cn);
  const signature = tlv(0x30, tlv(0x06, SHA256_WITH_RSA), tlv(0x05));
  const subjectAltName = tlv(
    0x30,
    tlv(
      0x30,
      tlv(0x06, SUBJECT_ALT_NAME),
      tlv(
        0x04,
        tlv(
          0x30,
          tlv(0x87, [127, 0, 0, 1]), // iPAddress 127.0.0.1
          tlv(0x82, [...Buffer.from('localhost')]), // dNSName localhost
        ),
      ),
    ),
  );
  const serial = crypto.randomBytes(8);
  serial[0] = (serial[0] % 0x7f) + 1; // positive, minimal one-to-eight-byte INTEGER
  const tbsCertificate = tlv(
    0x30,
    tlv(0xa0, tlv(0x02, [2])), // [0] EXPLICIT version v3
    tlv(0x02, serial),
    signature,
    name, // issuer
    tlv(0x30, utcTime(notBefore), utcTime(notAfter)),
    name, // subject (self-signed)
    publicKey.export({ type: 'spki', format: 'der' }),
    tlv(0xa3, subjectAltName), // [3] EXPLICIT extensions
  );
  const certificate = tlv(
    0x30,
    tbsCertificate,
    signature,
    tlv(0x03, [0x00, ...crypto.sign('sha256', Buffer.from(tbsCertificate), privateKey)]),
  );
  return {
    cert: toPem('CERTIFICATE', Buffer.from(certificate)),
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

module.exports = { createLocalhostCertificate };
