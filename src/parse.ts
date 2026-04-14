import ky from 'ky';
import { writeTextFile } from './utils/fs';
import { decodeSubscription } from './utils/decode-subscription';

export const getVlessSubscriptionNodes = async ({
  subscriptionUrl,
  requestHeaders,
  subscriptionOutputPath,
}: {
  subscriptionUrl: string;
  requestHeaders?: Record<string, string>;
  subscriptionOutputPath?: string;
}) => {
  const response = await ky.get(subscriptionUrl, {
    headers: requestHeaders,
  });
  const rawData = await response.text();
  const decodedData = decodeSubscription(rawData);
  const nodes = decodedData.split('\n').filter((line) => line.trim() !== '');
  const vlessNodes = nodes.filter((node) => node.startsWith('vless://'));
  console.log({ subscriptionOutputPath });
  if (subscriptionOutputPath) {
    await writeTextFile(subscriptionOutputPath, `${vlessNodes.join('\n')}\n`);
  }

  return vlessNodes;
};
