import { readFile, writeFile } from 'node:fs/promises';
const path = new URL('../supabase/schema.sql', import.meta.url);
const marker = '\n-- BEGIN GENERATED V24 UPGRADE\n';
const original = (await readFile(path, 'utf8')).split(/\r?\n-- BEGIN GENERATED V24 UPGRADE\r?\n/)[0];
const migrations = await Promise.all([
  '20260909_v24.sql',
  '20260909_v24_host_bomber_judgment.sql',
  '20260909_attack_activity.sql',
  '20260910_end_game_story.sql',
  '20260910_final_vote_and_history_lock.sql',
  '20260910_reporter_majority_limit.sql',
  '20260910_room_view_private_states.sql',
  '20260910_killer_target_protection.sql',
  '20260911_wife_revote.sql',
  '20260912_final_tie_runoff.sql',
  '20260923_private_realtime_broadcast.sql',
].map(file => readFile(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8')));
await writeFile(path, original + marker + migrations.join('\n'));
