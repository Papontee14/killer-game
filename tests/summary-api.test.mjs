import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(fs.readFileSync('app/api/room/summary/route.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function api({ room = { phase: 'ended' }, error = null, queryError = null } = {}) {
  let adminReads = 0;
  const filters = [];
  const query = {
    select() { return this; },
    eq(...args) { filters.push(args); return this; },
    then(resolve) { resolve({ data: [
      { id: 'assigned', player_secrets: { initial_role: 'detective', role_current: 'police', team: 'city', hearts: 2 } },
      { id: 'unassigned', player_secrets: null },
    ], error: queryError }); },
  };
  const exports = {};
  vm.runInNewContext(source, { exports, process: { env: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.test', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'secret',
  } }, require(name) {
    if (name === 'next/server') return { NextResponse: { json: (body, options) => ({ body, ...options }) } };
    return { createClient: (_, key) => key === 'anon'
      ? { rpc: async () => ({ data: room, error }) }
      : { from() { adminReads++; return query; } } };
  } });
  return { post: (token = 'Bearer valid') => exports.POST(new Request('https://example.test/api/room/summary', {
    method: 'POST', headers: token ? { Authorization: token } : {}, body: JSON.stringify({ code: 'ABCDEF' }),
  })), reads: () => adminReads, filters };
}

test('summary rejects unauthenticated callers, outsiders, RPC failures, and unfinished games before reading roles', async () => {
  const noAuth = api();
  assert.equal((await noAuth.post('')).status, 401);
  assert.equal(noAuth.reads(), 0);
  for (const options of [{ room: null }, { error: {} }, ...['lobby', 'active', 'police-check', 'bomb-resolution'].map(phase => ({ room: { phase } }))]) {
    const handler = api(options);
    assert.ok([403, 409].includes((await handler.post()).status));
    assert.equal(handler.reads(), 0);
  }
});

test('summary returns only roles and teams, handles unassigned players, and disables caching', async () => {
  const handler = api({ room: { phase: 'ended', closedAt: '2026-09-06' } });
  const result = await handler.post();
  assert.equal(result.status, 200);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.deepEqual(JSON.parse(JSON.stringify(result.body)), { endGameSummary: [
    { playerId: 'assigned', initialRole: 'detective', currentRole: 'police', team: 'city' },
    { playerId: 'unassigned', initialRole: null, currentRole: null, team: null },
  ] });
  assert.deepEqual(handler.filters, [['rooms.code', 'ABCDEF'], ['rooms.phase', 'ended']]);
});

test('database failures do not claim an empty successful reveal', async () => {
  assert.equal((await api({ queryError: {} }).post()).status, 503);
});
