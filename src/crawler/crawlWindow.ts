/**
 * platform_configs.crawl_window (예: "18:00-22:00") 이 KST 기준 현재 시각에 포함되는지 판단.
 */
export function isWithinCrawlWindow(
  crawlWindow: string | null | undefined,
  now = new Date(),
): boolean {
  if (!crawlWindow?.trim()) return true;

  const m = crawlWindow.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m) return true;

  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const minutes = kst.getHours() * 60 + kst.getMinutes();
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);

  if (start <= end) return minutes >= start && minutes <= end;
  // 자정 넘김 (예: 22:00-02:00)
  return minutes >= start || minutes <= end;
}
