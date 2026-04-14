export function normalizeUrl(input) {
  if (!input) return null;
  const value = input.trim();
  const url = value.startsWith('http://') || value.startsWith('https://') ? value : `https://${value}`;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function validateDomainPolicy(url, allowlist = [], blocklist = []) {
  const host = url.hostname.toLowerCase();
  if (blocklist.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) {
    return { ok: false, reason: 'Domain is blocked by policy.' };
  }
  if (allowlist.length && !allowlist.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
    return { ok: false, reason: 'Domain is not in allowlist.' };
  }
  return { ok: true };
}
