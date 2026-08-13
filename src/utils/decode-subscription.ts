const PROXY_LINK_PATTERN = /(?:^|\n)\s*(?:ss|ssr|vless|vmess|trojan|hysteria2?|hy2|tuic):\/\//;

// Subscriptions come either as a plain list of proxy links or as that list in Base64. Decoding
// blindly turns a plain-text response into mojibake that silently yields zero nodes, so the format is
// detected first and anything unrecognised is reported instead of guessed at.
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

  // Providers serve either standard Base64 or the URL-safe alphabet.
  const decoded = Buffer.from(compact.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8').trim();
  if (!PROXY_LINK_PATTERN.test(decoded)) {
    throw new Error('Decoded subscription does not contain any supported proxy links.');
  }

  return decoded;
};
