import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { query, closePool } from '../db/client.js';
import { storeResumePdf } from '../db/storage.js';
import { env } from '../config/env.js';

/**
 * data/resumes 로컬 PDF → Supabase Storage 업로드 후 candidate_documents.file_url 갱신
 */
async function main() {
  if (!env.supabaseUrl() || !env.supabaseServiceRoleKey()) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요');
  }

  // 버킷 생성 시도 (이미 있으면 무시)
  const bucketRes = await fetch(`${env.supabaseUrl()}/storage/v1/bucket`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.supabaseServiceRoleKey()}`,
      apikey: env.supabaseServiceRoleKey(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: 'resumes',
      name: 'resumes',
      public: true,
      file_size_limit: 10485760,
      allowed_mime_types: ['application/pdf'],
    }),
  });
  console.log('bucket create:', bucketRes.status, await bucketRes.text().then((t) => t.slice(0, 200)));

  const root = resolve(process.cwd(), 'data/resumes');
  if (!existsSync(root)) {
    console.log('no local resumes dir');
    return;
  }

  const platforms = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  let uploaded = 0;
  let updated = 0;

  for (const dir of platforms) {
    const files = readdirSync(join(root, dir.name)).filter((f) => f.endsWith('.pdf'));
    for (const file of files) {
      const ref = file.replace(/\.pdf$/i, '');
      const pdf = readFileSync(join(root, dir.name, file));
      const stored = await storeResumePdf({ platform: dir.name, ref, pdf });
      uploaded += 1;
      console.log('uploaded', dir.name, ref, stored.fileUrl);

      const res = await query(
        `UPDATE candidate_documents
         SET file_url = $1, file_hash = $2
         WHERE file_url LIKE $3 OR file_url = $4
         RETURNING id`,
        [
          stored.fileUrl,
          stored.fileHash,
          `%/${dir.name}/${ref}.pdf%`,
          `file://${join(root, dir.name, file).replace(/\\/g, '\\\\')}`,
        ],
      );
      // also match by ending path
      if (res.rowCount === 0) {
        const res2 = await query(
          `UPDATE candidate_documents
           SET file_url = $1, file_hash = COALESCE($2, file_hash)
           WHERE file_url LIKE $3
           RETURNING id`,
          [stored.fileUrl, stored.fileHash, `%${ref}.pdf%`],
        );
        updated += res2.rowCount;
      } else {
        updated += res.rowCount;
      }
    }
  }

  // any remaining file:// rows
  const leftover = await query(
    `SELECT id, file_url FROM candidate_documents WHERE file_url LIKE 'file://%'`,
  );
  console.log({ uploaded, updated, leftoverFileUrls: leftover.rows.length });
  for (const row of leftover.rows) {
    console.log(' leftover', row.id, row.file_url);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
