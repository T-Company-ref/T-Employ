import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from '../config/env.js';
import type { Platform } from '../db/types.js';

const SESSION_DIR = resolve(process.cwd(), '.sessions');
const SCREENSHOT_DIR = resolve(process.cwd(), 'screenshots');

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function sessionPath(platform: Platform, alias: string): string {
  return resolve(SESSION_DIR, `${platform}_${alias}.json`);
}

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  saveSession: () => Promise<void>;
  screenshot: (name: string) => Promise<string | null>;
  close: () => Promise<void>;
}

/**
 * Playwright 브라우저/컨텍스트를 생성한다.
 * PDF(page.pdf) 는 Chromium headless 에서만 동작하므로
 * CRAWL_FETCH_RESUMES=true 이면 headless 를 강제한다.
 */
export async function openSession(
  platform: Platform,
  alias = 'tbell-corp',
): Promise<BrowserSession> {
  ensureDir(SESSION_DIR);
  const statePath = sessionPath(platform, alias);
  const hasState = existsSync(statePath);

  const headless = env.headless() || env.crawlFetchResumes();
  if (!env.headless() && env.crawlFetchResumes()) {
    console.log('[browser] CRAWL_FETCH_RESUMES=true → headless 강제 (PDF 생성용)');
  }

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext(
    hasState ? { storageState: statePath } : undefined,
  );
  const page = await context.newPage();

  return {
    browser,
    context,
    page,
    saveSession: async () => {
      ensureDir(SESSION_DIR);
      await context.storageState({ path: statePath });
    },
    screenshot: async (name: string) => {
      if (!env.captureScreenshots()) return null;
      ensureDir(SCREENSHOT_DIR);
      const file = resolve(SCREENSHOT_DIR, `${platform}_${name}_${Date.now()}.png`);
      await page.screenshot({ path: file, fullPage: true });
      return file;
    },
    close: async () => {
      await context.close();
      await browser.close();
    },
  };
}
