import { closePool } from '../db/client.js';
import { listApplicantsByAppliedRange } from '../db/repositories/applicantAlerts.js';
import {
  listTalentsForDigest,
  TALENT_DIGEST_LIMIT,
  type TalentAlertRow,
} from '../db/repositories/talentAlerts.js';
import { sendCombinedDigestMail, sendDigestTalentMail } from '../mail/crawlResult.js';
import { getDigestReportSlices, isDigestDay, toKstParts } from '../mail/notifySchedule.js';
import { env } from '../config/env.js';
import { loadRouteMap } from '../crawler/routeMap.js';
import { openSession } from '../crawler/browser.js';
import { getConnector } from '../crawler/connectors/index.js';
import { verifyTalentSeekingOnPage } from '../crawler/resume/verifyTalentSeeking.js';

/**
 * 07:30 KST 다이제스트 (지원자 + 인재 한 통).
 * 구성: 저녁 지원 → 인재풀 → 근무시간 지원(전체)
 *
 * usage:
 *   npm run mail:morning-digest
 *   npm run mail:morning-digest -- --force
 *   npm run mail:morning-digest -- --force --talents-only
 */
async function pickVerifiedTalents(
  candidates: TalentAlertRow[],
  limit: number,
  options: { skipBrowser?: boolean } = {},
): Promise<TalentAlertRow[]> {
  if (options.skipBrowser) {
    console.log('[mail:digest] --no-browser — 메타 필터만 적용');
    return candidates.slice(0, limit);
  }
  const withUrl = candidates.filter((c) => c.profileUrl);
  if (withUrl.length === 0) return candidates.slice(0, limit);

  const platform = 'jobkorea';
  const routeMap = loadRouteMap(platform);
  let session;
  try {
    session = await openSession(platform);
  } catch (err) {
    console.warn('[mail:digest] 브라우저 불가 — 메타 필터만 적용:', (err as Error).message.slice(0, 120));
    return candidates.slice(0, limit);
  }
  const picked: TalentAlertRow[] = [];

  try {
    const login = await getConnector(platform).login(
      {
        page: session.page,
        routeMap,
        jobId: 'talent-digest',
        platform,
        log: async () => undefined,
      },
      env.platformCreds(platform),
    );
    if (!login.ok) {
      console.warn('[mail:digest] 인재 구직확인 로그인 실패 — 메타 필터만 적용');
      return candidates.slice(0, limit);
    }

    for (const cand of withUrl) {
      if (picked.length >= limit) break;
      const { verdict, detail } = await verifyTalentSeekingOnPage(session.page, cand.profileUrl!);
      console.log(`[talent-verify] ${cand.name} → ${verdict} (${detail.slice(0, 60)})`);
      if (verdict === 'hired' || verdict === 'unavailable') continue;
      picked.push({
        ...cand,
        jobStatus: cand.jobStatus || (verdict === 'seeking' ? '구직/이직 가능' : cand.jobStatus),
      });
    }
  } finally {
    await session.close().catch(() => undefined);
  }

  if (picked.length < limit) {
    for (const cand of candidates) {
      if (picked.length >= limit) break;
      if (picked.some((p) => p.talentId === cand.talentId)) continue;
      if (cand.profileUrl) continue;
      picked.push(cand);
    }
  }

  return picked;
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force') || process.argv.includes('--force-weekend');
  const talentsOnly = process.argv.includes('--talents-only');
  const toIdx = process.argv.indexOf('--to');
  if (toIdx >= 0 && process.argv[toIdx + 1]) {
    process.env.DIGEST_FORCE_TO = process.argv[toIdx + 1];
  }
  const skipBrowser =
    process.argv.includes('--no-browser') ||
    process.env.DIGEST_SKIP_BROWSER === 'true' ||
    process.env.DIGEST_SKIP_BROWSER === '1';
  const now = new Date();
  const kst = toKstParts(now);

  if (!force && !isDigestDay(now)) {
    console.log(`[mail:digest] 토·일 스킵 (KST ${kst.dateKey})`);
    return;
  }

  const slices = getDigestReportSlices(now);
  if (!slices) {
    console.log(`[mail:digest] 다이제스트 구간 없음 (KST ${kst.dateKey})`);
    return;
  }

  let evening: Awaited<ReturnType<typeof listApplicantsByAppliedRange>> = [];
  let workday: Awaited<ReturnType<typeof listApplicantsByAppliedRange>> = [];

  if (!talentsOnly) {
    evening = await listApplicantsByAppliedRange({
      start: slices.evening.start,
      end: slices.evening.end,
      includeAlerted: force,
    });
    workday = await listApplicantsByAppliedRange({
      start: slices.workday.start,
      end: slices.workday.end,
      includeAlerted: true, // 실시간 미수신자도 전일 근무분 전체 확인
    });
    console.log(
      `[mail:digest] ${slices.label} · 저녁 ${evening.length}명 · 근무 ${workday.length}명`,
    );
  }

  const talentCandidates = await listTalentsForDigest({
    start: slices.talent.start,
    end: slices.talent.end,
    force,
    limit: TALENT_DIGEST_LIMIT * 3,
  });
  console.log(`[mail:digest] 인재 후보 ${talentCandidates.length}명`);

  const talents = await pickVerifiedTalents(talentCandidates, TALENT_DIGEST_LIMIT, {
    skipBrowser,
  });
  console.log(`[mail:digest] 인재 확정 ${talents.length}명`);

  if (talentsOnly) {
    if (talents.length === 0) {
      console.log('[mail:digest] 발송할 인재 없음 — 메일 생략');
      return;
    }
    await sendDigestTalentMail(talents, {
      start: slices.talent.start,
      end: slices.talent.end,
    });
    return;
  }

  if (evening.length === 0 && talents.length === 0 && workday.length === 0) {
    console.log('[mail:digest] 발송할 지원자·인재 없음 — 메일 생략');
    return;
  }

  await sendCombinedDigestMail(evening, talents, workday, slices);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
