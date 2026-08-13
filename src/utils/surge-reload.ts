import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const RELOAD_TIMEOUT_MS = 10_000;

type HttpApiSettings = {
  key: string;
  origin: string;
};

// `[General] http-api = key@host:port`, optionally served over TLS when `http-api-tls = true`.
export const parseHttpApiSettings = (surgeText: string): HttpApiSettings | undefined => {
  const generalSection = surgeText.match(/\[General\]([\s\S]*?)(?=\n\[|$)/)?.[1];
  if (!generalSection) {
    return undefined;
  }

  const value = generalSection.match(/^\s*http-api\s*=\s*(.+)$/m)?.[1]?.trim();
  if (!value) {
    return undefined;
  }

  const separatorIndex = value.lastIndexOf('@');
  if (separatorIndex <= 0) {
    return undefined;
  }

  const key = value.slice(0, separatorIndex).trim();
  const address = value.slice(separatorIndex + 1).trim();
  if (!key || !address) {
    return undefined;
  }

  const useTls = /^\s*http-api-tls\s*=\s*true\s*$/m.test(generalSection);
  // Surge reports the bind address, which is often the wildcard; the request itself is local.
  const [host = '', port = ''] = address.split(':');
  const requestHost = host === '0.0.0.0' || host === '::' || host === '' ? '127.0.0.1' : host;

  return {
    key,
    origin: `${useTls ? 'https' : 'http'}://${requestHost}${port ? `:${port}` : ''}`,
  };
};

const reloadViaHttpApi = async ({ key, origin }: HttpApiSettings) => {
  const response = await fetch(`${origin}/v1/profiles/reload`, {
    method: 'POST',
    headers: { 'X-Key': key },
    signal: AbortSignal.timeout(RELOAD_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
};

const reloadViaCli = async () => {
  await execFileAsync('surge-cli', ['reload'], { timeout: RELOAD_TIMEOUT_MS });
};

/**
 * Asks Surge to reload the profile that was just rewritten. Surge does not watch the file, so
 * without this the generated nodes only appear after a manual reload.
 *
 * Never throws: a failed reload leaves a correct profile on disk that the user can load by hand.
 */
export const reloadSurgeProfile = async (surgeText: string) => {
  const httpApi = parseHttpApiSettings(surgeText);

  if (httpApi) {
    try {
      await reloadViaHttpApi(httpApi);
      return { reloaded: true, via: 'http-api' as const };
    } catch (error) {
      console.warn(`Surge HTTP API reload failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  try {
    await reloadViaCli();
    return { reloaded: true, via: 'surge-cli' as const };
  } catch {
    if (!httpApi) {
      console.warn(
        'Could not reload Surge automatically. Reload the profile manually, or enable the HTTP API by adding `http-api = <your-key>@127.0.0.1:6171` to [General].',
      );
    }

    return { reloaded: false, via: undefined };
  }
};
