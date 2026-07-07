import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { RouteMap } from './types.js';
import type { Platform } from '../db/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTES_DIR = resolve(__dirname, '../../config/routes');

/** 플랫폼 Route Map(YAML)을 로드하고 최소 구조를 검증한다. */
export function loadRouteMap(platform: Platform): RouteMap {
  const file = resolve(ROUTES_DIR, `${platform}.yaml`);
  const raw = readFileSync(file, 'utf8');
  const parsed = parse(raw) as RouteMap;

  if (!parsed.platform || parsed.platform !== platform) {
    throw new Error(`Route Map platform 불일치: ${file}`);
  }
  if (!parsed.login?.url) {
    throw new Error(`Route Map login.url 누락: ${file}`);
  }
  if (!parsed.selectors) {
    throw new Error(`Route Map selectors 누락: ${file}`);
  }
  return parsed;
}

/** selectors 키를 실제 CSS 셀렉터로 해석한다. */
export function resolveSelector(map: RouteMap, key: string): string {
  const sel = map.selectors[key];
  if (!sel) throw new Error(`셀렉터 미정의: ${key} (${map.platform})`);
  return sel;
}

/** 설정에 TODO 셀렉터가 남아있는지 확인 (dry-run 검증용) */
export function findUnsetSelectors(map: RouteMap): string[] {
  return Object.entries(map.selectors)
    .filter(([, v]) => !v || v.startsWith('TODO'))
    .map(([k]) => k);
}
