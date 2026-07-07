import type { Connector } from '../types.js';
import type { Platform } from '../../db/types.js';
import { JobkoreaConnector } from './jobkorea.js';
import { SaraminConnector } from './saramin.js';

const registry: Record<string, () => Connector> = {
  jobkorea: () => new JobkoreaConnector(),
  saramin: () => new SaraminConnector(),
};

export function getConnector(platform: Platform): Connector {
  const factory = registry[platform];
  if (!factory) throw new Error(`커넥터 미등록 플랫폼: ${platform}`);
  return factory();
}

export function registeredPlatforms(): string[] {
  return Object.keys(registry);
}
