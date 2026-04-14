export const normalizeBase64 = (base64: string): string => {
  const cleaned = base64.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = cleaned.length % 4;
  if (padding === 0) {
    return cleaned;
  }
  return cleaned + '='.repeat(4 - padding);
};
