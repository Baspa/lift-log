const API = 'https://api.github.com';
const DEFAULT_PATH = 'history.json';
const BASE64_CHUNK_BYTES = 0x8000;
const REQUEST_TIMEOUT_MS = 30_000;

export class BackupError extends Error {
  constructor(status) {
    super(`GitHub answered ${status}`);
    this.status = status;
  }
}

const pathOf = (config) => config.path ?? DEFAULT_PATH;
const isNotFound = (error) => error instanceof BackupError && error.status === 404;

async function request({ token }, path, { accept = 'application/vnd.github+json', ...init } = {}) {
  // GitHub lets browsers cache answers for 60 s and a stale sha makes the next write conflict. A unique query
  // skips that cache; cache: 'no-store' could add Cache-Control/Pragma headers, which GitHub's CORS rules refuse.
  const isRead = !init.method;
  const response = await fetch(`${API}${path}${isRead ? `?fresh=${Date.now()}` : ''}`, {
    ...init,
    // iOS can suspend the app mid-request and leave it hanging; without a timeout no backup runs again.
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!response.ok) throw new BackupError(response.status);
  return response;
}

export async function checkRepo(config) {
  await request(config, `/repos/${config.repo}`);
}

export async function readBackup(config) {
  try {
    const response = await request(config, `/repos/${config.repo}/contents/${pathOf(config)}`, { accept: 'application/vnd.github.raw+json' });
    return await response.json();
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

// The folder listing has the sha for files of any size; asking for the file itself stops working above 1 MB.
export async function currentSha(config) {
  const path = pathOf(config);
  const folder = path.split('/').slice(0, -1).join('/');
  try {
    const entries = await (await request(config, `/repos/${config.repo}/contents/${folder}`)).json();
    return entries.find((entry) => entry.path === path)?.sha ?? null;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function writeBackup(config, json, sha, message) {
  const body = JSON.stringify({ message, content: toBase64(json), ...(sha && { sha }) });
  const response = await request(config, `/repos/${config.repo}/contents/${pathOf(config)}`, { method: 'PUT', body });
  return (await response.json()).content.sha;
}

export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_BYTES) binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK_BYTES));
  return btoa(binary);
}

export async function fingerprint(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
