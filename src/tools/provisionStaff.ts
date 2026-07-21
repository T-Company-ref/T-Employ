/**
 * Supabase Auth 사용자 + staff_profiles 등록.
 *
 * usage:
 *   npx tsx src/tools/provisionStaff.ts \
 *     --email yh.park@tbell.co.kr \
 *     --password '***' \
 *     --name 박영호 \
 *     --nick yh.park \
 *     --role recommender \
 *     --notify digest
 */
import { closePool, query } from '../db/client.js';
import { env } from '../config/env.js';

function arg(name: string, fallback = ''): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = env.supabaseUrl();
  const key = env.supabaseServiceRoleKey();
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요');
  return fetch(`${url.replace(/\/$/, '')}/auth/v1${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

async function main(): Promise<void> {
  const email = arg('email').trim().toLowerCase();
  const password = arg('password');
  const displayName = arg('name', email.split('@')[0] || email);
  const nickname = arg('nick', email.split('@')[0] || 'staff');
  const role = arg('role', 'recommender');
  const notify = arg('notify', 'digest');

  if (!email || !password) {
    console.error('usage: provisionStaff --email ... --password ... [--name] [--nick] [--role] [--notify]');
    process.exitCode = 1;
    return;
  }

  const listRes = await adminFetch('/admin/users?page=1&per_page=200');
  if (!listRes.ok) throw new Error(`listUsers ${listRes.status}: ${await listRes.text()}`);
  const listed = (await listRes.json()) as {
    users?: Array<{ id: string; email?: string; user_metadata?: Record<string, unknown> }>;
  };
  let user = (listed.users || []).find((u) => (u.email || '').toLowerCase() === email);

  if (!user) {
    const createdRes = await adminFetch('/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName },
      }),
    });
    if (!createdRes.ok) throw new Error(`createUser ${createdRes.status}: ${await createdRes.text()}`);
    user = (await createdRes.json()) as { id: string; email?: string };
    console.log(`[provision] Auth 사용자 생성: ${email}`);
  } else {
    const updatedRes = await adminFetch(`/admin/users/${user.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        password,
        email_confirm: true,
        user_metadata: { ...(user.user_metadata || {}), display_name: displayName },
      }),
    });
    if (!updatedRes.ok) throw new Error(`updateUser ${updatedRes.status}: ${await updatedRes.text()}`);
    user = (await updatedRes.json()) as { id: string; email?: string };
    console.log(`[provision] Auth 사용자 갱신(비밀번호 포함): ${email}`);
  }

  const existing = await query<{ id: string }>(
    `SELECT id FROM staff_profiles WHERE lower(email) = lower($1) LIMIT 1`,
    [email],
  );

  if (existing.rows[0]) {
    await query(
      `UPDATE staff_profiles
       SET auth_user_id = $2,
           nickname = $3,
           display_name = $4,
           role = $5,
           notify_pref = $6,
           is_active = true,
           updated_at = now()
       WHERE id = $1`,
      [existing.rows[0].id, user.id, nickname, displayName, role, notify],
    );
    console.log(`[provision] staff_profiles 갱신: ${existing.rows[0].id}`);
  } else {
    const inserted = await query<{ id: string }>(
      `INSERT INTO staff_profiles (auth_user_id, email, nickname, display_name, role, notify_pref, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       RETURNING id`,
      [user.id, email, nickname, displayName, role, notify],
    );
    console.log(`[provision] staff_profiles 생성: ${inserted.rows[0].id}`);
  }

  console.log(
    JSON.stringify(
      { email, role, notify_pref: notify, nickname, display_name: displayName, auth_user_id: user.id },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
