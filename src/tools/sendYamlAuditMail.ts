/**
 * YAML 전체 검수 결과를 yj.kim@tbell.co.kr 로 발송
 * npx tsx src/tools/sendYamlAuditMail.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { env } from '../config/env.js';
import { sendHtmlMail } from '../mail/transport.js';

function loadEnv() {
  const p = resolve(process.cwd(), '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    if (process.env[key] != null) continue;
    process.env[key] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function main() {
  loadEnv();
  const audit = spawnSync('npx', ['tsx', 'src/tools/auditYaml.ts'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: true,
  });
  if (audit.status !== 0 && !existsSync('artifacts/yaml-audit.json')) {
    throw new Error(audit.stderr || audit.stdout || 'audit failed');
  }

  const report = JSON.parse(readFileSync('artifacts/yaml-audit.json', 'utf8')) as {
    scannedAt: string;
    totalFiles: number;
    okCount: number;
    errorCount: number;
    warnCount: number;
    errors: Array<{ file: string; message: string }>;
    warns: Array<{ file: string; message: string }>;
    okFiles: string[];
  };

  const errRows = report.errors.length
    ? report.errors
        .map((e) => `<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#b91c1c"><b>ERROR</b></td><td style="padding:8px;border-bottom:1px solid #eee"><code>${esc(e.file)}</code><div style="color:#64748b;font-size:12px;margin-top:4px">${esc(e.message)}</div></td></tr>`)
        .join('')
    : `<tr><td colspan="2" style="padding:12px;color:#059669">파싱 오류 없음</td></tr>`;

  const warnRows = report.warns.length
    ? report.warns
        .slice(0, 40)
        .map((w) => `<tr><td style="padding:8px;border-bottom:1px solid #eee;color:#b45309"><b>WARN</b></td><td style="padding:8px;border-bottom:1px solid #eee"><code>${esc(w.file)}</code><div style="color:#64748b;font-size:12px;margin-top:4px">${esc(w.message)}</div></td></tr>`)
        .join('')
    : `<tr><td colspan="2" style="padding:12px;color:#059669">경고 없음</td></tr>`;

  const okList = report.okFiles.map((f) => `<li><code>${esc(f)}</code></li>`).join('');

  const html = `<div style="font-family:Segoe UI,Apple SD Gothic Neo,sans-serif;max-width:720px;margin:0 auto;color:#0f172a">
    <h2 style="margin:0 0 8px">[TBELL] YAML 전체 검수 결과</h2>
    <p style="color:#64748b;margin:0 0 16px">스캔 시각(UTC): ${esc(report.scannedAt)}</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:16px">
      <tr>
        <td style="padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;text-align:center;width:25%"><div style="font-size:12px;color:#64748b">전체</div><div style="font-size:22px;font-weight:800">${report.totalFiles}</div></td>
        <td style="width:8px"></td>
        <td style="padding:12px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;text-align:center;width:25%"><div style="font-size:12px;color:#047857">OK</div><div style="font-size:22px;font-weight:800">${report.okCount}</div></td>
        <td style="width:8px"></td>
        <td style="padding:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;text-align:center;width:25%"><div style="font-size:12px;color:#b91c1c">ERROR</div><div style="font-size:22px;font-weight:800">${report.errorCount}</div></td>
        <td style="width:8px"></td>
        <td style="padding:12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;text-align:center;width:25%"><div style="font-size:12px;color:#b45309">WARN</div><div style="font-size:22px;font-weight:800">${report.warnCount}</div></td>
      </tr>
    </table>
    <h3 style="margin:18px 0 8px">오류</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0">${errRows}</table>
    <h3 style="margin:18px 0 8px">경고</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0">${warnRows}</table>
    <h3 style="margin:18px 0 8px">정상 파일 (${report.okCount})</h3>
    <ul style="font-size:13px;line-height:1.6">${okList}</ul>
    <p style="margin-top:20px;font-size:12px;color:#94a3b8">조치: 인코딩이 깨진 workflow description/주석을 ASCII로 정리해 push 했습니다. 스케줄 워크플로(session-refresh / crawl-talent / poll-applicants 등)는 기존과 동일합니다.</p>
  </div>`;

  const to = ['yj.kim@tbell.co.kr'];
  const subject = `[TBELL] YAML 검수 · 전체 ${report.totalFiles} · ERROR ${report.errorCount} · WARN ${report.warnCount}`;
  const result = await sendHtmlMail({ to, subject, html, allowDryRun: false });
  console.log(`[yaml-audit-mail] sent via ${result.provider} → ${to.join(', ')}`);
  console.log(JSON.stringify({
    totalFiles: report.totalFiles,
    okCount: report.okCount,
    errorCount: report.errorCount,
    warnCount: report.warnCount,
  }));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
