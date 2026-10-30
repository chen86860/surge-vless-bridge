import type { SingBoxVlessOutbound } from '../types/sing-box-vless-outbound';

export const inboundTagForPort = (port: number) => `socks-in-${port}`;

// One sing-box process serves every node: each node gets its own SOCKS inbound on its own port, and a
// route rule pins that inbound to the node's outbound.
export const parseTemplate = (nodes: Array<{ outbound: SingBoxVlessOutbound; port: number }>) => ({
  log: {
    level: 'error',
    timestamp: true,
  },
  inbounds: nodes.map(({ port }) => ({
    type: 'socks',
    tag: inboundTagForPort(port),
    listen: '127.0.0.1',
    listen_port: port,
  })),
  outbounds: nodes.map(({ outbound }) => ({ ...outbound })),
  route: {
    rules: nodes.map(({ outbound, port }) => ({
      inbound: [inboundTagForPort(port)],
      outbound: outbound.tag,
    })),
    final: nodes[0]?.outbound.tag,
  },
});
