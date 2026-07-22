/**
 * 공고/인재 카테고리 백필
 * npx tsx src/tools/backfillCategories.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

for (const line of readFileSync(resolve(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  const key = m[1].trim();
  if (process.env[key] != null) continue;
  process.env[key] = m[2].trim().replace(/^["']|["']$/g, '');
}

import { closePool, query } from '../db/client.js';
import {
  classifyPostingTitle,
  classifyTalentProfile,
  type JobCategory,
} from '../domain/jobCategories.js';

async function main() {
  const posts = await query<{ id: string; title: string | null }>(
    `SELECT id, title FROM job_postings`,
  );
  let postUpdated = 0;
  for (const p of posts.rows) {
    const category: JobCategory = classifyPostingTitle(p.title);
    await query(`UPDATE job_postings SET category = $2 WHERE id = $1`, [p.id, category]);
    postUpdated += 1;
    console.log('[posting]', category, p.title);
  }

  const talents = await query<{
    id: string;
    headline: string | null;
    summary_text: string | null;
    search_condition: string | null;
    profile_meta: {
      skills?: string[];
      roles?: string[];
      badges?: string[];
    } | null;
  }>(`SELECT id, headline, summary_text, search_condition, profile_meta FROM talent_pool_candidates`);

  const counts: Record<string, number> = { qa: 0, dev: 0, office: 0, other: 0 };
  for (const t of talents.rows) {
    const category = classifyTalentProfile({
      headline: t.headline,
      summaryText: t.summary_text,
      searchCondition: t.search_condition,
      skills: t.profile_meta?.skills,
      roles: t.profile_meta?.roles,
      badges: t.profile_meta?.badges,
    });
    await query(`UPDATE talent_pool_candidates SET category = $2 WHERE id = $1`, [t.id, category]);
    counts[category] = (counts[category] ?? 0) + 1;
  }

  console.log('postings', postUpdated, 'talents', counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
