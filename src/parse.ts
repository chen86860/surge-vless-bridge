import { writeTextFile } from './utils/fs';
import { decodeSubscription } from './utils/decode-subscription';

const SUBSCRIPTION_TIMEOUT_MS = 15_000;

export const getVlessSubscriptionNodes = async ({
  subscriptionUrl,
  requestHeaders,
  subscriptionOutputPath,
}: {
  subscriptionUrl: string;
  requestHeaders?: Record<string, string>;
  subscriptionOutputPath?: string;
}) => {
  const response = await fetch(subscriptionUrl, {
    headers: requestHeaders,
    signal: AbortSignal.timeout(SUBSCRIPTION_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch subscription: ${response.status} ${response.statusText}`);
  }

  const rawData = await response.text();
  const decodedData = decodeSubscription(rawData);
  const nodes = decodedData
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const vlessNodes = [...new Set(nodes.filter((node) => node.startsWith('vless://')))];
  if (vlessNodes.length === 0) {
    throw new Error('Subscription contains no VLESS nodes; refusing to update the Surge profile.');
  }

  if (subscriptionOutputPath) {
    await writeTextFile(subscriptionOutputPath, `${vlessNodes.join('\n')}\n`);
  }

  return vlessNodes;
};
