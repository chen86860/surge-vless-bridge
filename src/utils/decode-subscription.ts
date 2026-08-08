const PROXY_LINK_PATTERN = /(?:^|\n)\s*(?:ss|vless|vmess|trojan):\/\//m;

export const decodeSubscription = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Subscription response is empty.');
  }

  if (PROXY_LINK_PATTERN.test(trimmed)) {
    return trimmed;
  }

  const compact = trimmed.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact) || compact.length % 4 === 1) {
    throw new Error('Subscription response is neither a proxy link list nor valid Base64.');
  }

  const normalized = compact.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = Buffer.from(normalized, 'base64').toString('utf8').trim();
  if (!PROXY_LINK_PATTERN.test(decoded)) {
    throw new Error('Decoded subscription does not contain supported proxy links.');
  }

  return decoded;
};
