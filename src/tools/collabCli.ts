import { addCandidateTag, listTagsForTarget, removeCandidateTag } from '../db/repositories/tags.js';
import { scheduleInterview, updateInterviewResult, listInterviewsForCandidate } from '../db/repositories/interviews.js';
import { recordStatusChange, blockCandidate, blockTalentPool, listStatusHistory } from '../db/repositories/candidateStatus.js';
import { closePool } from '../db/client.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1 || i + 1 >= process.argv.length) return undefined;
  return process.argv[i + 1];
}

function usage(): never {
  console.log(`
협업 CLI (Phase 3) — 태그/면접/상태/블락

  tag add <applicant|talent_pool> <targetId> --actor <nickname> [--type recommend|watch|flag] [--comment "..."]
  tag remove <tagId> --actor <nickname>
  tag list <applicant|talent_pool> <targetId>

  interview schedule <candidateId> --at <ISO> --actor <nickname> [--application <id>] [--interviewer "..."] [--type onsite|online|phone]
  interview result <interviewId> --result pass|fail|no_show|canceled --actor <nickname> [--hired-date YYYY-MM-DD] [--note "..."]
  interview list <candidateId>

  status set <candidateId> --code <statusCode> --actor <nickname> [--application <id>] [--reason "..."]
  status history <candidateId>

  block candidate <candidateId> --actor <nickname> [--application <id>] [--reason "..."]
  block talent <talentPoolId> --actor <nickname> [--reason "..."]
`);
  process.exit(1);
}

async function main(): Promise<void> {
  const [, , domain, action, ...rest] = process.argv;
  const actor = arg('--actor');
  if (!domain || !action) usage();

  if (domain === 'tag') {
    if (action === 'add') {
      const [targetType, targetId] = rest.filter((x) => !x.startsWith('--'));
      if (!targetType || !targetId || !actor) usage();
      const tag = await addCandidateTag({
        targetType: targetType as 'applicant' | 'talent_pool',
        targetId,
        tagType: (arg('--type') as 'recommend' | 'watch' | 'flag') ?? 'recommend',
        comment: arg('--comment'),
        actorNickname: actor,
      });
      console.log('[collab] tag added:', tag);
      return;
    }
    if (action === 'remove') {
      const tagId = rest[0];
      if (!tagId || !actor) usage();
      await removeCandidateTag({ tagId, actorNickname: actor });
      console.log('[collab] tag removed:', tagId);
      return;
    }
    if (action === 'list') {
      const [targetType, targetId] = rest;
      if (!targetType || !targetId) usage();
      const tags = await listTagsForTarget(targetType as 'applicant' | 'talent_pool', targetId);
      console.table(tags);
      return;
    }
  }

  if (domain === 'interview') {
    if (action === 'schedule') {
      const candidateId = rest[0];
      const at = arg('--at');
      if (!candidateId || !at || !actor) usage();
      const event = await scheduleInterview({
        candidateId,
        applicationId: arg('--application'),
        interviewAt: at,
        interviewer: arg('--interviewer'),
        meetingType: arg('--type') as 'onsite' | 'online' | 'phone' | undefined,
        note: arg('--note'),
        actorNickname: actor,
      });
      console.log('[collab] interview scheduled:', event);
      return;
    }
    if (action === 'result') {
      const interviewId = rest[0];
      const result = arg('--result') as 'pass' | 'fail' | 'no_show' | 'canceled';
      if (!interviewId || !result || !actor) usage();
      const event = await updateInterviewResult({
        interviewId,
        result,
        hiredStartDate: arg('--hired-date'),
        note: arg('--note'),
        actorNickname: actor,
      });
      console.log('[collab] interview updated:', event);
      return;
    }
    if (action === 'list') {
      const candidateId = rest[0];
      if (!candidateId) usage();
      console.table(await listInterviewsForCandidate(candidateId));
      return;
    }
  }

  if (domain === 'status') {
    if (action === 'set') {
      const candidateId = rest[0];
      const code = arg('--code');
      if (!candidateId || !code || !actor) usage();
      await recordStatusChange({
        candidateId,
        applicationId: arg('--application'),
        statusCode: code as Parameters<typeof recordStatusChange>[0]['statusCode'],
        reason: arg('--reason'),
        actorNickname: actor,
        syncApplicationStage: Boolean(arg('--application')),
      });
      console.log('[collab] status recorded:', code);
      return;
    }
    if (action === 'history') {
      const candidateId = rest[0];
      if (!candidateId) usage();
      console.table(await listStatusHistory(candidateId));
      return;
    }
  }

  if (domain === 'block') {
    if (!actor) usage();
    if (action === 'candidate') {
      const candidateId = rest[0];
      if (!candidateId) usage();
      await blockCandidate({
        candidateId,
        applicationId: arg('--application'),
        reason: arg('--reason'),
        actorNickname: actor,
      });
      console.log('[collab] candidate blocked:', candidateId);
      return;
    }
    if (action === 'talent') {
      const talentPoolId = rest[0];
      if (!talentPoolId) usage();
      await blockTalentPool({
        talentPoolId,
        reason: arg('--reason'),
        actorNickname: actor,
      });
      console.log('[collab] talent blocked:', talentPoolId);
      return;
    }
  }

  usage();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
