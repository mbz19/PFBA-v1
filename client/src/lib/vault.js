// The encrypted finance vault: the finance SQLite database, encrypted in the
// browser with a key derived from the user's passphrase, stored as one file
// in the primary account's hidden Drive app folder (appDataFolder). Google
// only ever holds ciphertext; the passphrase and key never leave the device.
//
// File layout: "PFBA" | version (1 byte) | salt (16) | iv (12) | AES-GCM ciphertext
// The salt is fixed for the life of the vault (so a device can keep its
// derived key); every upload uses a fresh IV.

import { authedFetch } from './auth.js';

const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FILE_NAME = 'pfba-finance.vault';
const MAGIC = [0x50, 0x46, 0x42, 0x41]; // "PFBA"
const VERSION = 1;
const HEADER = MAGIC.length + 1 + 16 + 12;
const PBKDF2_ITERATIONS = 600000;

export class WrongPassphrase extends Error {
  constructor() { super('That passphrase doesn\'t unlock your finances.'); this.name = 'WrongPassphrase'; }
}

// ---------------------------------------------------------------------------
// Crypto
// ---------------------------------------------------------------------------
export const newSalt = () => crypto.getRandomValues(new Uint8Array(16));

// Non-extractable AES-GCM key; it can be kept in IndexedDB but never read out.
export async function deriveKey(passphrase, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

export async function encrypt(key, salt, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(HEADER + ct.length);
  out.set(MAGIC, 0);
  out[4] = VERSION;
  out.set(salt, 5);
  out.set(iv, 21);
  out.set(ct, HEADER);
  return out;
}

// The salt stored in a vault file (needed to derive the key on a new device).
export function saltOf(file) {
  check(file);
  return file.slice(5, 21);
}

export async function decrypt(key, file) {
  check(file);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: file.slice(21, HEADER) }, key, file.slice(HEADER)));
  } catch {
    throw new WrongPassphrase();
  }
}

function check(file) {
  if (file.length < HEADER || MAGIC.some((b, i) => file[i] !== b) || file[4] !== VERSION) {
    throw new Error('The finance vault file is damaged or from an unknown version.');
  }
}

// ---------------------------------------------------------------------------
// Drive appDataFolder
// ---------------------------------------------------------------------------
// { id, version } of the vault file, or null if there isn't one yet.
export async function find(email) {
  const res = await authedFetch(email, DRIVE, {
    query: {
      spaces: 'appDataFolder',
      q: `name = '${FILE_NAME}' and trashed = false`,
      fields: 'files(id,version)',
      orderBy: 'modifiedTime desc',
    },
  });
  const f = res?.files?.[0];
  return f ? { id: f.id, version: f.version } : null;
}

export async function download(email, id) {
  return new Uint8Array(await authedFetch(email, `${DRIVE}/${encodeURIComponent(id)}`, { query: { alt: 'media' }, binary: true }));
}

// Creates the file when id is null. Returns { id, version }.
export async function upload(email, id, bytes) {
  if (id) {
    return authedFetch(email, `${UPLOAD}/${encodeURIComponent(id)}`, {
      method: 'PATCH', query: { uploadType: 'media', fields: 'id,version' }, raw: bytes,
    });
  }
  const boundary = `pfba${crypto.getRandomValues(new Uint32Array(1))[0]}`;
  const meta = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'] });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
    `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`, bytes, `\r\n--${boundary}--`,
  ]);
  return authedFetch(email, UPLOAD, {
    method: 'POST', query: { uploadType: 'multipart', fields: 'id,version' },
    raw: body, contentType: `multipart/related; boundary=${boundary}`,
  });
}
