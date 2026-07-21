/**
 * Supabase Auth 사용자 생성 + staff_profiles(viewer 등) 연결.
 *
 * 비밀번호는 인자/환경변수로만 전달하고 로그에 출력하지 않음.
 *
 * usage:
 *   npx tsx src/tools/createStaffUsers.ts \
 *     --email=a@tbell.co.kr --password=*** --nickname=a --name=홍길동 --role=viewer
 */
import { closePool, query } from '../db/client.js';
import { env } from '../config/env.js';

type Role = 'operator' | 'recruiter' | 'executive' | 'viewer' | 'staff' | 'recommender';

type UserSpec = {
  email: string;
  password: string;
  nickname: string;
  displayName: string;
  role: Role;
};

function parseArgs(): UserSpec[] {
  const args = process.argv.slice(2);
  if (args.includes('--batch-viewers') || args.includes('--batch-recommenders')) {
    const p1 = process.env.VIEWER_PASS_JONGHYUK ?? '';
    const p2 = process.env.VIEWER_PASS_HJJOO ?? '';
    if (!p1 || !p2) {
      throw new Error('VIEWER_PASS_JONGHYUK / VIEWER_PASS_HJJOO 환경변수가 필요합니다');
    }
    return [
      {
        email: 'jonghyuk.kim@tbell.co.kr',
        password: p1,
        nickname: 'jonghyuk.kim',
        displayName: '김종혁',
        role: 'recommender',
      },
      {
        email: 'hj.joo@tbell.co.kr',
        password: p2,
        nickname: 'hj.joo',
        displayName: '주호정',
        role: 'recommender',
      },
    ];
  }

  const get = (key: string): string => {
    const hit = args.find((a) => a.startsWith(`--${key}=`));
    return hit ? hit.slice(key.length + 3) : '';
  };
  const email = get('email');
  const password = get('password');
  const nickname = get('nickname');
  const displayName = get('name') || nickname;
  const role = (get('role') || 'viewer') as Role;
  if (!email || !password || !nickname) {
    throw new Error('usage: --email= --password= --nickname= [--name=] [--role=viewer]');
  }
  return [{ email, password, nickname, displayName, role }];
}

async function ensureAuthUser(
  url: string,
  serviceKey: string,
  email: string,
  password: string,
): Promise<string> {
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  const create = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      app_metadata: { provider: 'email' },
    }),
  });
  const createBody = (await create.json()) as { id?: string; msg?: string; error?: string; message?: string };

  if (create.ok && createBody.id) {
    return createBody.id;
  }

  const msg = `${createBody.msg || createBody.error || createBody.message || ''}`.toLowerCase();
  if (create.status === 422 || msg.includes('already') || msg.includes('registered')) {
    const list = await fetch(
      `${url}/auth/v1/admin/users?page=1&per_page=200`,
      { headers },
    );
    if (!list.ok) {
      throw new Error(`auth_list_failed: HTTP ${list.status}`);
    }
    const data = (await list.json()) as { users?: Array<{ id: string; email?: string }> };
    const found = (data.users ?? []).find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
    if (!found) throw new Error(`auth_user_exists_but_not_found: ${email}`);

    const upd = await fetch(`${url}/auth/v1/admin/users/${found.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ password, email_confirm: true }),
    });
    if (!upd.ok) {
      const t = await upd.text();
      throw new Error(`auth_password_update_failed: HTTP ${upd.status}`);
    }
    return found.id;
  }

  throw new Error(`auth_create_failed: HTTP ${create.status} ${createBody.msg || createBody.message || ''}`);
}

async function upsertStaff(spec: UserSpec, authUserId: string): Promise<void> {
  await query(
    `INSERT INTO staff_profiles (nickname, display_name, email, role, auth_user_id, is_active)
     VALUES ($1, $2, $3, $4, $5::uuid, true)
     ON CONFLICT (nickname) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       email = EXCLUDED.email,
       role = EXCLUDED.role,
       auth_user_id = EXCLUDED.auth_user_id,
       is_active = true`,
    [spec.nickname, spec.displayName, spec.email, spec.role, authUserId],
  );
}

async function main(): Promise<void> {
  const url = env.supabaseUrl();
  const key = env.supabaseServiceRoleKey();
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요');
  }

  const specs = parseArgs();
  for (const spec of specs) {
    const id = await ensureAuthUser(url, key, spec.email, spec.password);
    await upsertStaff(spec, id);
    console.log(`[create-staff] ok email=${spec.email} role=${spec.role} auth_id=${id}`);
  }
}

main()
  .catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[create-staff] failed:', message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
