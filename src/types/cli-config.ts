export type AddressResolverStrategy = 'system' | 'doh' | 'dns' | 'off';

export type AddressResolverConfig = {
  strategy: AddressResolverStrategy;
  dohEndpoint: string;
  dnsServers: string[];
  filterSurgeFakeIp: boolean;
};

// A bare URL, or a URL with per-subscription options: `prefix` is prepended to every node name from
// it, and `group` puts its nodes in their own Surge policy group instead of `policyGroupName`.
export type SubscriptionEntry = string | { url: string; prefix?: string; group?: string };

export type CliConfig = {
  subscriptionUrl?: string;
  subscriptionUrls?: SubscriptionEntry[];
  // Proxy that a failed subscription fetch is retried through with curl, e.g. Surge's own
  // `http://127.0.0.1:6152`.
  subscriptionProxy?: string;
  vlessNodes?: string[];
  surgeConfigPath: string;
  singBoxBinary: string;
  outputDir: string;
  backupDir: string;
  policyGroupName: string;
  proxyStartMarker: string;
  proxyEndMarker: string;
  portStart: number;
  backupKeep: number;
  autoReload: boolean;
  subscriptionOutputPath: string;
  requestHeaders: Record<string, string>;
  addressResolver: AddressResolverConfig;
};

export type CliConfigInput = Partial<Omit<CliConfig, 'addressResolver'>> & {
  addressResolver?: AddressResolverStrategy | Partial<AddressResolverConfig>;
};
