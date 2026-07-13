import { query } from '../client.js';

export interface StaffProfile {
  id: string;
  nickname: string;
  display_name: string | null;
  email: string | null;
  role: string;
  is_active: boolean;
}

export async function getStaffByNickname(nickname: string): Promise<StaffProfile | null> {
  const res = await query<StaffProfile>(
    `SELECT id, nickname, display_name, email, role, is_active
     FROM staff_profiles
     WHERE nickname = $1 AND is_active = true
     LIMIT 1`,
    [nickname],
  );
  return res.rows[0] ?? null;
}

export async function requireStaff(nickname: string): Promise<StaffProfile> {
  const staff = await getStaffByNickname(nickname);
  if (!staff) throw new Error(`staff_not_found: ${nickname}`);
  return staff;
}
