import { query, closePool } from '../db/client.js';

async function main() {
  const apps = await query<{ total: string; missing: string; broken: string }>(
    `SELECT
       count(*)::text AS total,
       count(*) FILTER (
         WHERE d.file_url IS NULL OR d.file_url NOT LIKE 'http%'
       )::text AS missing,
       count(*) FILTER (
         WHERE d.file_url LIKE 'http%'
       )::text AS broken
     FROM applications a
     LEFT JOIN candidate_documents d
       ON d.application_id = a.id AND d.doc_type = 'resume'
     WHERE a.platform = 'jobkorea' AND a.is_active = true`,
  );
  console.log('applicants', apps.rows[0]);

  const talents = await query<{ total: string; missing: string }>(
    `SELECT
       count(*)::text AS total,
       count(*) FILTER (
         WHERE d.file_url IS NULL OR d.file_url NOT LIKE 'http%'
       )::text AS missing
     FROM talent_pool_candidates t
     LEFT JOIN candidate_documents d
       ON d.talent_pool_id = t.id AND d.doc_type = 'resume'
     WHERE t.is_active = true`,
  );
  console.log('talents', talents.rows[0]);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
