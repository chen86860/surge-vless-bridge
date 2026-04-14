import type { SingBoxVlessOutbound } from '../types/sing-box-vless-outbound';

export const parseTemplate = ({
  node,
  port,
}: {
  node: SingBoxVlessOutbound | SingBoxVlessOutbound[];
  port: number;
}) => {
  return {
    log: {
      level: 'error',
      timestamp: true,
    },
    inbounds: [
      {
        type: 'socks',
        tag: 'socks-in',
        listen: '127.0.0.1',
        listen_port: port,
      },
    ],
    outbounds: (Array.isArray(node) ? node : [node]).map((item) => ({ ...item })),
    route: {
      final: Array.isArray(node) ? node?.[0]?.tag : node.tag,
    },
  };
};
