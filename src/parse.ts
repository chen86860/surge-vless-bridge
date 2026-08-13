import { writeTextFile } from './utils/fs';
import { decodeSubscription } from './utils/decode-subscription';

// Subscription URLs carry a token, in the query string or in the path itself, so failures name the
// provider by origin only. Without this, a user with several subscriptions cannot tell which one
// returned the error.
const describeSubscriptionUrl = (subscriptionUrl: string) => {
  try {
    const url = new URL(subscriptionUrl);
    return url.protocol === 'data:' ? 'data: URL' : url.origin;
  } catch {
    return 'subscription URL';
  }
};

export const getVlessSubscriptionNodes = async ({
  subscriptionUrl,
  requestHeaders,
  subscriptionOutputPath,
}: {
  subscriptionUrl: string;
  requestHeaders?: Record<string, string>;
  subscriptionOutputPath?: string;
}) => {
  const source = describeSubscriptionUrl(subscriptionUrl);

  let response: Response;
  try {
    response = await fetch(subscriptionUrl, {
      headers: requestHeaders,
    });
  } catch (error) {
    throw new Error(`Failed to fetch subscription ${source}: ${error instanceof Error ? error.message : error}`);
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch subscription ${source}: ${response.status} ${response.statusText}`);
  }

  const rawData = await response.text();
  const decodedData = decodeSubscription(rawData);
  const nodes = decodedData.split('\n').filter((line) => line.trim() !== '');
  const vlessNodes = nodes.filter((node) => node.startsWith('vless://'));
  if (subscriptionOutputPath) {
    await writeTextFile(subscriptionOutputPath, `${vlessNodes.join('\n')}\n`);
  }

  return vlessNodes;
};
