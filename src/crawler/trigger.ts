/** GitHub Actions 이벤트 기준 트리거 유형 */
export function crawlTriggerType(): 'manual' | 'schedule' {
  return process.env.GITHUB_EVENT_NAME === 'schedule' ? 'schedule' : 'manual';
}
