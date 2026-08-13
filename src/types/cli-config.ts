export type AddressResolverStrategy = 'system' | 'doh' | 'dns' | 'off';

export type AddressResolverConfig = {
  strategy: AddressResolverStrategy;
  dohEndpoint: string;
  dnsServers: string[];
  filterSurgeFakeIp: boolean;
};

export type CliConfig = {
  subscriptionUrl?: string;
  subscriptionUrls?: string[];
  vlessNodes?: string[];
  surgeConfigPath: string;
  singBoxBinary: string;
  outputDir: string;
  backupDir: string;
  policyGroupName: string;
  proxyStartMarker: string;
  proxyEndMarker: string;
  portStart: number;
  subscriptionOutputPath: string;
  requestHeaders: Record<string, string>;
  addressResolver: AddressResolverConfig;
};

export type CliConfigInput = Partial<Omit<CliConfig, 'addressResolver'>> & {
  addressResolver?: AddressResolverStrategy | Partial<AddressResolverConfig>;
};
