import { join } from 'node:path';

export type Ask = (question: string) => Promise<string>;

// Prompting is only safe when a human is on both ends. Under an agent, in CI, or behind a pipe there
// is nobody to answer, and a `readline` question would hang forever instead of failing.
export const isInteractive = () => Boolean(process.stdin.isTTY && process.stdout.isTTY);

// Colour is only ever emitted behind `isInteractive()`, but NO_COLOR is still honoured: some people
// pipe a pty through a recorder, and an escape sequence in a transcript is noise.
const useColor = () => isInteractive() && !process.env.NO_COLOR;

export const dim = (value: string) => (useColor() ? `\u001b[2m${value}\u001b[22m` : value);

export const cyan = (value: string) => (useColor() ? `\u001b[36m${value}\u001b[39m` : value);

// Dragging the file in from Finder is the obvious move when detection came up empty, and what lands
// on the line is shell-escaped: quoted, or with backslashes before every space. Nothing unescapes it
// here the way a shell would, so this does.
export const normalizePastedPath = (value: string) => {
  const unquoted = value.replace(/^(['"])([\s\S]*)\1$/, '$2');
  const unescaped = unquoted.replace(/\\(.)/g, '$1');
  const home = process.env.HOME;

  return home && unescaped.startsWith('~/') ? join(home, unescaped.slice(2)) : unescaped;
};

export const withPrompt = async <T>(run: (ask: Ask) => Promise<T>): Promise<T> => {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  // Closing stdin — Ctrl+D, or a pipe that ran dry — rejects the pending question. That is not a
  // failure worth a stack trace: an empty answer means "skip", which every caller already handles.
  const ask: Ask = async (question) => {
    try {
      return await rl.question(question);
    } catch {
      return '';
    }
  };

  try {
    return await run(ask);
  } finally {
    rl.close();
  }
};

// A subscription URL is a credential, and a vless:// link carries its UUID in the userinfo; echo back
// only enough to confirm the right one landed. `origin` is unusable here because it is "null" for any
// non-special scheme, vless:// included.
export const redactUrl = (value: string) => {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}/…`;
  } catch {
    return '…';
  }
};
