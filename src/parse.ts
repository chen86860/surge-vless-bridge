import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { writeTextFile } from './utils/fs';
import { decodeSubscription } from './utils/decode-subscription';

const execFileAsync = promisify(execFile);

const SUBSCRIPTION_TIMEOUT_MS = 15_000;
const SUBSCRIPTION_MAX_BYTES = 16 * 1024 * 1024;

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

// A proxy URL may carry credentials (`http://user:pass@host:port`); only its address is ever printed.
const describeProxy = (proxy: string) => {
  try {
    const url = new URL(proxy);
    return `${url.protocol}//${url.host}`;
  } catch {
    return 'the configured proxy';
  }
};

const fetchDirect = async (subscriptionUrl: string, requestHeaders?: Record<string, string>) => {
  let response: Response;
  try {
    response = await fetch(subscriptionUrl, {
      headers: requestHeaders,
      // Without a deadline an unresponsive provider hangs `sync` indefinitely.
      signal: AbortSignal.timeout(SUBSCRIPTION_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.text();
};

// curl rather than a proxy-aware fetch: Node's fetch has no proxy support without extra dependencies,
// and some providers reject Node's TLS fingerprint but accept curl's. The URL is passed as an argument,
// never through a shell, and curl's own errors name the host at most, not the token in the path.
const fetchViaProxy = async (subscriptionUrl: string, proxy: string, requestHeaders?: Record<string, string>) => {
  const headerArgs = Object.entries(requestHeaders ?? {}).flatMap(([key, value]) => ['-H', `${key}: ${value}`]);

  try {
    const { stdout } = await execFileAsync(
      'curl',
      ['-fsSL', '--max-time', String(SUBSCRIPTION_TIMEOUT_MS / 1000), '-x', proxy, ...headerArgs, '--', subscriptionUrl],
      { maxBuffer: SUBSCRIPTION_MAX_BYTES, timeout: SUBSCRIPTION_TIMEOUT_MS + 5_000 },
    );
    return stdout;
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr).trim() : '';
    throw new Error(stderr || (error instanceof Error ? error.message : String(error)));
  }
};

export const getVlessSubscriptionNodes = async ({
  subscriptionUrl,
  requestHeaders,
  subscriptionOutputPath,
  proxy,
}: {
  subscriptionUrl: string;
  requestHeaders?: Record<string, string>;
  subscriptionOutputPath?: string;
  proxy?: string;
}) => {
  const source = describeSubscriptionUrl(subscriptionUrl);

  let rawData: string;
  try {
    rawData = await fetchDirect(subscriptionUrl, requestHeaders);
  } catch (directError) {
    const directReason = directError instanceof Error ? directError.message : String(directError);
    if (!proxy) {
      throw new Error(`Failed to fetch subscription ${source}: ${directReason}`);
    }

    try {
      rawData = await fetchViaProxy(subscriptionUrl, proxy, requestHeaders);
    } catch (proxyError) {
      const proxyReason = proxyError instanceof Error ? proxyError.message : String(proxyError);
      throw new Error(
        `Failed to fetch subscription ${source}: ${directReason}; retry through ${describeProxy(proxy)} failed: ${proxyReason}`,
      );
    }

    console.warn(
      `Fetched subscription ${source} through ${describeProxy(proxy)} after the direct request failed (${directReason}).`,
    );
  }

  const decodedData = decodeSubscription(rawData);
  const nodes = decodedData
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const vlessNodes = [...new Set(nodes.filter((node) => node.startsWith('vless://')))];
  if (subscriptionOutputPath) {
    await writeTextFile(subscriptionOutputPath, `${vlessNodes.join('\n')}\n`);
  }

  return vlessNodes;
};
