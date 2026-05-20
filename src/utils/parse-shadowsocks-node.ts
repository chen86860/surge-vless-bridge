import type { SingBoxShadowsocksOutbound } from '../types/sing-box-vless-outbound';

const decodeBase64 = (value: string) => {
  const normalized = decodeURIComponent(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  return Buffer.from(padded, 'base64').toString('utf8');
};

const splitMethodAndPassword = (value: string) => {
  const separatorIndex = value.indexOf(':');
  if (separatorIndex === -1) {
    return undefined;
  }

  return {
    method: value.slice(0, separatorIndex),
    password: value.slice(separatorIndex + 1),
  };
};

const parseUserInfo = (value: string) => splitMethodAndPassword(decodeBase64(value)) ?? splitMethodAndPassword(value);

const parseServer = (value: string) => {
  const url = new URL(`ss://${value}`);
  const port = Number(url.port);

  return {
    host: url.hostname,
    port,
  };
};

export const parseShadowsocksNode = (node: string, index: number): SingBoxShadowsocksOutbound => {
  const url = new URL(node);
  const tag = decodeURIComponent(url.hash.replace(/^#/, '')) || `ss-${index + 1}`;

  let credentials = parseUserInfo(url.username);
  let host = url.hostname;
  let port = Number(url.port);

  if (!credentials && url.username && url.password) {
    credentials = {
      method: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    };
  }

  if (!credentials && !url.username && !url.hostname.includes('.')) {
    const decoded = decodeBase64(node.slice('ss://'.length).replace(/#.*/, '').replace(/\?.*/, ''));
    const atIndex = decoded.lastIndexOf('@');
    if (atIndex !== -1) {
      credentials = splitMethodAndPassword(decoded.slice(0, atIndex));
      const server = parseServer(decoded.slice(atIndex + 1));
      host = server.host;
      port = server.port;
    }
  }

  if (!credentials?.method || !credentials.password || !host || Number.isNaN(port)) {
    throw new Error(`Invalid shadowsocks node at index ${index + 1}: ${node}`);
  }

  return {
    type: 'shadowsocks',
    tag,
    server: host,
    server_port: port,
    method: credentials.method,
    password: credentials.password,
  };
};
