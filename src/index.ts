import { loadCliConfig } from './configuration';
import { syncSubscriptionToSurge } from './surge';

const main = async () => {
  const { config } = await loadCliConfig({ cwd: process.cwd() });
  const result = await syncSubscriptionToSurge(config);
  console.log(`Synced ${result.count} nodes.`);
  console.log(`Backup saved to ${result.backupPath}`);
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
