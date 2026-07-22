import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from 'yaml';

type Finding = {
  file: string;
  severity: 'error' | 'warn';
  message: string;
};

function walk(dir: string, out: string[] = []): string[] {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'artifacts', 'data', 'dist'].includes(ent.name)) continue;
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.ya?ml$/i.test(ent.name)) out.push(p);
  }
  return out;
}

function auditFile(abs: string, root: string): Finding[] {
  const file = relative(root, abs).replace(/\\/g, '/');
  const findings: Finding[] = [];
  let text: string;
  try {
    text = readFileSync(abs, 'utf8');
  } catch (e) {
    return [{ file, severity: 'error', message: `read failed: ${(e as Error).message}` }];
  }

  if (text.includes('\uFFFD')) {
    findings.push({ file, severity: 'warn', message: 'contains U+FFFD replacement chars (encoding corruption)' });
  }

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const desc = line.match(/^\s*description:\s*"(.*)$/);
    if (desc && !/"\s*$/.test(line.trim()) && !line.trim().endsWith('"')) {
      findings.push({ file, severity: 'error', message: `unclosed description quote at line ${i + 1}` });
    }
    // mojibake / replacement-char heuristics
    if (
      (line.includes('\uFFFD') || /\?{2,}/.test(line) || /[\u00C3\u00A0-\u00FF]{3,}/.test(line)) &&
      (/^\s*#/.test(line) || /description:/.test(line))
    ) {
      findings.push({
        file,
        severity: 'warn',
        message: `possible mojibake/encoding noise at line ${i + 1}: ${line.trim().slice(0, 80)}`,
      });
    }
  }

  try {
    parse(text);
  } catch (e) {
    findings.push({ file, severity: 'error', message: `YAML parse failed: ${(e as Error).message}` });
  }

  return findings;
}

const root = process.cwd();
const files = walk(root).sort();
const allFindings: Finding[] = [];
const okFiles: string[] = [];

for (const f of files) {
  const findings = auditFile(f, root);
  const rel = relative(root, f).replace(/\\/g, '/');
  if (findings.length === 0) okFiles.push(rel);
  else allFindings.push(...findings);
}

const errors = allFindings.filter((f) => f.severity === 'error');
const warns = allFindings.filter((f) => f.severity === 'warn');

const report = {
  scannedAt: new Date().toISOString(),
  totalFiles: files.length,
  okCount: okFiles.length,
  errorCount: errors.length,
  warnCount: warns.length,
  errors,
  warns,
  okFiles,
};

if (!existsSync('artifacts')) mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/yaml-audit.json', JSON.stringify(report, null, 2));

console.log(JSON.stringify({ totalFiles: report.totalFiles, okCount: report.okCount, errorCount: report.errorCount, warnCount: report.warnCount }, null, 2));
for (const e of errors) console.log('ERROR', e.file, e.message);
for (const w of warns) console.log('WARN', w.file, w.message);
