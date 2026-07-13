import { query, closePool } from '../db/client.js';
import { env } from '../config/env.js';

/** file:// URL 을 Supabase public URL 로 일괄 교체 */
async function main() {
  const base = `${env.supabaseUrl().replace(/\/$/, '')}/storage/v1/object/public/resumes`;
  const rows = await query<{ id: string; file_url: string }>(
    `SELECT id, file_url FROM candidate_documents WHERE file_url LIKE 'file://%'`,
  );
  console.log('to update', rows.rows.length);

  for (const row of rows.rows) {
    const m = row.file_url.match(/resumes[\\/]+([^\\/]+)[\\/]+([^\\/?#]+\.pdf)/i);
    if (!m) {
      console.log('skip unparsed', row.id, row.file_url);
      continue;
    }
    const [, platform, file] = m;
    const next = `${base}/${platform}/${file}`;
    await query(`UPDATE candidate_documents SET file_url = $1 WHERE id = $2`, [next, row.id]);
    console.log('updated', row.id, '→', next);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
