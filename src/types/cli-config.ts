export type CliConfig = {
  subscriptionUrl?: string;
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
};

export type CliConfigInput = Partial<CliConfig>;
