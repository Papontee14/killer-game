import { readFile, writeFile } from 'node:fs/promises';
const path = new URL('../supabase/schema.sql', import.meta.url);
const marker = '\n-- BEGIN GENERATED V24 UPGRADE\n';
const original = (await readFile(path, 'utf8')).split(/\r?\n-- BEGIN GENERATED V24 UPGRADE\r?\n/)[0];
const migrations = await Promise.all([
  '20260909_v24.sql',
  '20260909_v24_host_bomber_judgment.sql',
  '20260909_attack_activity.sql',
].map(file => readFile(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8')));
await writeFile(path, original + marker + migrations.join('\n'));
