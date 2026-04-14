export const decodeSubscription = (raw: string): string =>
  Buffer.from(raw, 'base64').toString('utf8');
