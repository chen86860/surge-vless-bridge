import type { SingBoxVlessOutbound } from '../types/sing-box-vless-outbound';
import { toBoolean } from './base';

export const parseVlessNode = (node: string, index: number): SingBoxVlessOutbound => {
  const url = new URL(node);
  const uuid = decodeURIComponent(url.username);
  const host = url.hostname;
  const port = Number(url.port || '443');

  if (!uuid || !host || Number.isNaN(port)) {
    throw new Error(`Invalid vless node at index ${index + 1}: ${node}`);
  }

  const params = url.searchParams;
  const security = params.get('security') ?? '';
  const type = params.get('type') ?? '';

  const pbk = params.get('pbk') ?? '';
  const sid = params.get('sid') ?? '';

  const fp = params.get('fp');
  const insecure = params.get('insecure');
  const sni = params.get('sni') ?? params.get('serverName');
  const allowInsecure = toBoolean(params.get('allowInsecure'));
  const flow = params.get('flow') ?? undefined;
  const packetEncoding = params.get('packetEncoding') ?? params.get('packet_encoding');
  const tag = decodeURIComponent(url.hash.replace(/^#/, '')) || `vless-${index + 1}`;

  // Without a public key sing-box starts but the reality handshake always fails, which surfaces in
  // Surge as an external proxy that dies on every request rather than as a config error.
  if (security === 'reality' && !pbk) {
    throw new Error(`Reality node at index ${index + 1} is missing its public key (pbk).`);
  }

  const outbound: SingBoxVlessOutbound = {
    type: 'vless',
    tag,
    server: host,
    server_port: port,
    uuid,
  };

  if (flow) {
    outbound.flow = flow;
  }

  if (packetEncoding?.toLowerCase() === 'xudp') {
    outbound.packet_encoding = 'xudp';
  }

  if (security === 'tls' || security === 'reality') {
    // `record_fragment` is only meaningful when enabled, and it does not exist before sing-box 1.12.
    // Emitting the default made every generated config unparsable on older builds, which sing-box
    // reports as `json: unknown field` and Surge shows as "External Proxy Process Terminated".
    outbound.tls = {
      enabled: true,
      insecure: toBoolean(insecure),
      alpn: ['http/1.1'],
    };

    if (sni) {
      outbound.tls.server_name = sni;
    }

    if (allowInsecure) {
      outbound.tls.insecure = true;
    }

    if (fp) {
      outbound.tls.utls = {
        enabled: true,
        fingerprint: fp,
      };
    }

    if (pbk) {
      outbound.tls.reality = {
        enabled: true,
        public_key: pbk,
        short_id: sid,
      };
    }
  }

  if (type === 'ws') {
    const path = params.get('path') ?? '/';
    const hostHeader = params.get('host') ?? params.get('Host') ?? undefined;

    outbound.transport = {
      type: 'ws',
      path,
    };

    if (hostHeader) {
      outbound.transport.headers = {
        Host: hostHeader,
      };
    }
  }

  if (type === 'grpc') {
    const serviceName = params.get('serviceName') ?? params.get('service_name') ?? 'grpc';
    outbound.transport = {
      type: 'grpc',
      service_name: serviceName,
    };
  }

  if (type === 'http' || type === 'httpupgrade') {
    const path = params.get('path') ?? '/';
    const hostHeader = params.get('host') ?? params.get('Host') ?? undefined;

    outbound.transport = {
      type: 'httpupgrade',
      path,
      host: hostHeader ?? host,
    };
  }

  return outbound;
};
