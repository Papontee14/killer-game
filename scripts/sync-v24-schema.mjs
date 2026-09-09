import { readFile, writeFile } from 'node:fs/promises';
const path = new URL('../supabase/schema.sql', import.meta.url);
const marker = '\n-- BEGIN GENERATED V24 UPGRADE\n';
const original = (await readFile(path, 'utf8')).split(/\r?\n-- BEGIN GENERATED V24 UPGRADE\r?\n/)[0];
const migration = await readFile(new URL('../supabase/migrations/20260909_v24.sql', import.meta.url), 'utf8');
await writeFile(path, original + marker + migration);
