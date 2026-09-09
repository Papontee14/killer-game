import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const code = ts.transpileModule(
  readFileSync("app/api/game/tick/route.ts", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
function api(error = null) {
  const exports = {};
  let calls = 0;
  vm.runInNewContext(code, {
    exports,
    process: {
      env: {
        GAME_TICK_SECRET: "scheduler-secret",
        NEXT_PUBLIC_SUPABASE_URL: "https://example.test",
        SUPABASE_SERVICE_ROLE_KEY: "service-key",
      },
    },
    require(name) {
      if (name === "next/server")
        return {
          NextResponse: { json: (body, options) => ({ body, ...options }) },
        };
      return {
        createClient: () => ({
          rpc: async (name) => {
            assert.equal(name, "advance_v24_schedule");
            calls++;
            return { error };
          },
        }),
      };
    },
  });
  return {
    post: (token) =>
      exports.POST(
        new Request("https://example.test/api/game/tick", {
          method: "POST",
          headers: token ? { Authorization: token } : {},
        }),
      ),
    calls: () => calls,
  };
}
test("clock endpoint rejects missing/wrong credentials without invoking the database", async () => {
  const a = api();
  assert.equal((await a.post()).status, 401);
  assert.equal((await a.post("Bearer wrong")).status, 401);
  assert.equal(a.calls(), 0);
});
test("trusted scheduler invokes clock and reports database failure", async () => {
  const a = api();
  assert.equal((await a.post("Bearer scheduler-secret")).body.ok, true);
  assert.equal(a.calls(), 1);
  assert.equal(
    (await api({ message: "internal" }).post("Bearer scheduler-secret")).status,
    503,
  );
});
