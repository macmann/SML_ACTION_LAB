import { canonical, controlNames, normalizeCall } from "./tool-registry.mjs";

export function reportedUsage(response) {
  const usage = response?.usage;
  if (!usage || typeof usage !== "object") return undefined;
  const valid = Object.fromEntries(["prompt_tokens", "completion_tokens", "total_tokens"].flatMap((key) =>
    Number.isSafeInteger(usage[key]) && usage[key] >= 0 ? [[key, usage[key]]] : []));
  return Object.keys(valid).length ? valid : undefined;
}

export function scoreRoute(response, expected) {
  const call = normalizeCall(response);
  const schemaValid = call.status === "valid";
  const toolCorrect = Boolean(schemaValid && call.name === expected.name);
  return { validation: call.status, predictedTool: call.name ?? null, arguments: schemaValid ? call.args : null,
    schemaValid, toolCorrect, exact: toolCorrect && canonical(call.args) === canonical(expected.arguments),
    controlCorrect: controlNames.has(expected.name) ? toolCorrect : null };
}

export function aggregateArena(rows) {
  const groups = new Map();
  for (const row of rows) {
    const result = row.result;
    if (!result || result.mode !== "routing") continue;
    const identity = result.identity === "attested" && result.variant === "tuned" ? "verified tuned" :
      result.identity === "attested" ? "attested other" : "unverified";
    const key = [result.provider, row.model, identity].join(" / ");
    const counts = groups.get(key) ?? { key, total: 0, schemaValid: 0, toolCorrect: 0, exact: 0, controls: 0, controlCorrect: 0,
      fixtureRuns: 0, fixturePassed: 0, failed: 0 };
    counts.total++;
    if (result.error) counts.failed++;
    if (result.schemaValid) counts.schemaValid++;
    if (result.toolCorrect) counts.toolCorrect++;
    if (result.exact) counts.exact++;
    if (result.controlCorrect != null) { counts.controls++; if (result.controlCorrect) counts.controlCorrect++; }
    if (result.fixture === "pass" || result.fixture === "fail") { counts.fixtureRuns++; if (result.fixture === "pass") counts.fixturePassed++; }
    groups.set(key, counts);
  }
  return [...groups.values()];
}
