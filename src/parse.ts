import { writeTextFile } from './utils/fs';
import { decodeSubscription } from './utils/decode-subscription';

export const getSupportedSubscriptionNodes = async ({
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
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch subscription: ${response.status} ${response.statusText}`);
  }

  const rawData = await response.text();
  const decodedData = decodeSubscription(rawData);
  const nodes = decodedData.split('\n').filter((line) => line.trim() !== '');
  const supportedNodes = nodes.filter((node) => node.startsWith('vless://') || node.startsWith('ss://'));
  if (subscriptionOutputPath) {
    await writeTextFile(subscriptionOutputPath, `${supportedNodes.join('\n')}\n`);
  }

  return supportedNodes;
};

export const getVlessSubscriptionNodes = getSupportedSubscriptionNodes;
