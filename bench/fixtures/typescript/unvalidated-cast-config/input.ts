interface RemoteConfig {
  featureFlags: Record<string, boolean>;
  rolloutPercentage: number;
  supportEmail: string;
}

const CONFIG_URL = 'https://config.internal/app.json';

let cached: RemoteConfig | null = null;

export async function loadRemoteConfig(): Promise<RemoteConfig> {
  if (cached != null) {
    return cached;
  }

  const response = await fetch(CONFIG_URL);
  const body = await response.json();

  const config = body as RemoteConfig;

  cached = config;
  return config;
}

export function rolloutIncludes(userBucket: number, config: RemoteConfig): boolean {
  return userBucket < config.rolloutPercentage;
}
