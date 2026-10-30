'use strict';

// Checks an update before the app trusts it. The release job signs latest.json
// with Notchman's Ed25519 key (kept in AWS Parameter Store); the app has the
// public half. latest.json lists each installer's SHA-256, so a download is
// installed only if it is byte for byte the one that was released, and only
// from Notchman's own downloads site.

const crypto = require('node:crypto');

class UpdateError extends Error {}

/** latest.json, once its signature checks out with `publicKey` (PEM). Throws UpdateError otherwise. */
function verifiedManifest(body, signature, publicKey) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  let valid = false;
  try {
    valid = crypto.verify(null, bytes, publicKey, Buffer.from(String(signature).trim(), 'base64'));
  } catch {
    valid = false;
  }
  if (!valid) throw new UpdateError('The update information is not signed by Notchman.');
  return JSON.parse(bytes.toString('utf8'));
}

/** True for an https link on the downloads site itself. */
function fromDownloadsSite(url, downloadsURL) {
  try {
    const link = new URL(url);
    return link.protocol === 'https:' && link.host === new URL(downloadsURL).host;
  } catch {
    return false;
  }
}

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

/** True if `data` is the released file: its SHA-256 matches the signed one. */
function matchesRelease(data, expected) {
  return typeof expected === 'string' && /^[0-9a-f]{64}$/.test(expected) && sha256(data) === expected;
}

module.exports = { UpdateError, verifiedManifest, fromDownloadsSite, matchesRelease, sha256 };
