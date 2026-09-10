// Deterministic bounds and candidate enumeration, NOT a win-rate simulation.
// node scripts/analyze-v24-balance.mjs [--all]
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

export async function readPresets() {
  const source = await readFile(new URL("../src/v24-presets.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const module = { exports: {} };
  new Function("exports", "module", outputText)(module.exports, module);
  return module.exports.V24_GAME_PRESETS;
}

const optional = ["detective", "reporter", "killer-wife", "athlete", "doctor", "bomber"];
export function originalRoles(n) {
  return { killer: 1, police: 1, detective: 1, reporter: +(n >= 6),
    "killer-wife": +(n >= 8), athlete: +(n >= 9), doctor: +(n >= 10),
    bomber: +(n >= 11), sumo: 0, villager: n === 5 || n === 6 ? 2 : n === 12 ? 4 : 3 };
}

export function bounds(n, roles, durationMinutes) {
  const cutoff = durationMinutes - 30;
  // Earliest ordinary death >=45; subsequent lethal attacks >=60 apart.
  // Strict capture-before-cutoff: a lethal hit AT cutoff cannot be submitted.
  const normalKillUpper = Math.max(0, Math.ceil((cutoff - 45) / 60));
  const killerVotes = 1 + roles["killer-wife"];
  const extraCityDeathUpper = roles.bomber;
  const cityFloor = Math.max(0, n - killerVotes - normalKillUpper - extraCityDeathUpper);
  const minKillsToVote = Math.max(2, Math.floor(cutoff / 120));
  return { cutoff, reporterMinimumAlive: Math.floor(n / 2) + 1,
    minKillsToVote, normalKillUpper, extraCityDeathUpper, killerVotes, cityFloor,
    // Sufficient condition only; failing does not prove a reachable loss.
    cityMajorityGuaranteedIfFinal: cityFloor > killerVotes,
    huntPopulationPossible: minKillsToVote <= n - killerVotes - 1 };
}

export function candidates(n) {
  const result = [];
  const original = originalRoles(n);
  for (let mask = 0; mask < 2 ** optional.length; mask++) {
    const roles = { killer: 1, police: 1, sumo: 0 };
    optional.forEach((role, i) => { roles[role] = (mask >> i) & 1; });
    roles.villager = n - Object.values(roles).reduce((a, b) => a + b, 0);
    if (roles.villager < 0 || roles.villager > 20) continue;
    for (let minutes = 180; minutes <= 600; minutes += 30) {
      const metrics = bounds(n, roles, minutes);
      result.push({ playerCount: n, durationMinutes: minutes, roleCounts: roles, ...metrics,
        roleEdits: Object.keys(original).reduce((sum, role) => sum + Math.abs(original[role] - roles[role]), 0),
        // Explicit design screen: preserve lineage and an information role at 6+.
        eligible: !!roles.detective && (n === 5 || !!roles.reporter) &&
          metrics.huntPopulationPossible && metrics.cityMajorityGuaranteedIfFinal });
    }
  }
  return result;
}

export function recommend(n) {
  return candidates(n).filter(x => x.eligible).sort((a, b) =>
    a.roleEdits - b.roleEdits || b.normalKillUpper - a.normalKillUpper || a.durationMinutes - b.durationMinutes)[0];
}

export function summary() {
  const previousProposal = [180, 240, 300, 240, 300, 360, 360, 420];
  return Array.from({ length: 8 }, (_, i) => {
    const n = i + 5, rows = candidates(n), chosen = recommend(n);
    return { playerCount: n, candidates: rows.length, eligible: rows.filter(x => x.eligible).length,
      original: bounds(n, originalRoles(n), (n - 2) * 60),
      previousProposal: bounds(n, originalRoles(n), previousProposal[i]),
      recommended: chosen };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(process.argv.includes("--all")
    ? Array.from({ length: 8 }, (_, i) => candidates(i + 5)).flat()
    : summary(), null, 2));
}
