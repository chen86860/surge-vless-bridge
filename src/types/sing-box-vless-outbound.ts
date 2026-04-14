export type SingBoxTls = {
  enabled: boolean;
  server_name?: string;
  insecure?: boolean;
  alpn?: string[];
  record_fragment?: boolean;
  utls?: {
    enabled: boolean;
    fingerprint: string;
  };
  reality?: {
    enabled: boolean;
    public_key: string;
    short_id?: string;
  };
};

export type SingBoxTransport = {
  type: string;
  path?: string;
  host?: string;
  headers?: Record<string, string>;
  service_name?: string;
};

export type SingBoxVlessOutbound = {
  type: 'vless';
  tag: string;
  server: string;
  server_port: number;
  uuid: string;
  flow?: string;
  packet_encoding?: 'xudp';
  tls?: SingBoxTls;
  transport?: SingBoxTransport;
  network?: string;
  ntp?: unknown;
};
