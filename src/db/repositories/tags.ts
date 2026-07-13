import { query } from '../client.js';
import { requireStaff } from './staff.js';

export type TagTargetType = 'applicant' | 'talent_pool';
export type TagType = 'recommend' | 'watch' | 'flag';

export interface CandidateTag {
  id: string;
  target_type: TagTargetType;
  target_id: string;
  tag_type: TagType;
  comment: string | null;
  tagged_by: string;
  tagged_at: Date;
  is_active: boolean;
}

async function writeAudit(params: {
  tagId: string | null;
  action: 'add' | 'remove' | 'comment_update';
  actorId: string;
  snapshot: Record<string, unknown>;
}): Promise<void> {
  await query(
    `INSERT INTO tag_audit_logs (tag_id, action, actor_id, snapshot)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [params.tagId, params.action, params.actorId, JSON.stringify(params.snapshot)],
  );
}

/** 추천/관심 태그 추가 — 작성자(tagged_by) 및 tag_audit_logs 기록 */
export async function addCandidateTag(params: {
  targetType: TagTargetType;
  targetId: string;
  tagType?: TagType;
  comment?: string;
  actorNickname: string;
}): Promise<CandidateTag> {
  const staff = await requireStaff(params.actorNickname);
  const tagType = params.tagType ?? 'recommend';

  const res = await query<CandidateTag>(
    `INSERT INTO candidate_tags (target_type, target_id, tag_type, comment, tagged_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (target_type, target_id, tag_type, tagged_by)
     DO UPDATE SET
       comment = COALESCE(EXCLUDED.comment, candidate_tags.comment),
       is_active = true,
       tagged_at = now()
     RETURNING *`,
    [params.targetType, params.targetId, tagType, params.comment ?? null, staff.id],
  );

  const tag = res.rows[0];
  await writeAudit({
    tagId: tag.id,
    action: 'add',
    actorId: staff.id,
    snapshot: { targetType: params.targetType, targetId: params.targetId, tagType, comment: params.comment },
  });
  return tag;
}

/** 태그 소프트 삭제(is_active=false) + 감사 로그 */
export async function removeCandidateTag(params: {
  tagId: string;
  actorNickname: string;
}): Promise<void> {
  const staff = await requireStaff(params.actorNickname);
  const existing = await query<CandidateTag>(
    `SELECT * FROM candidate_tags WHERE id = $1`,
    [params.tagId],
  );
  const tag = existing.rows[0];
  if (!tag) throw new Error(`tag_not_found: ${params.tagId}`);

  await query(
    `UPDATE candidate_tags SET is_active = false WHERE id = $1`,
    [params.tagId],
  );
  await writeAudit({
    tagId: params.tagId,
    action: 'remove',
    actorId: staff.id,
    snapshot: { tag },
  });
}

/** 대상별 활성 태그 목록 */
export async function listTagsForTarget(
  targetType: TagTargetType,
  targetId: string,
): Promise<CandidateTag[]> {
  const res = await query<CandidateTag>(
    `SELECT * FROM candidate_tags
     WHERE target_type = $1 AND target_id = $2 AND is_active = true
     ORDER BY tagged_at DESC`,
    [targetType, targetId],
  );
  return res.rows;
}
