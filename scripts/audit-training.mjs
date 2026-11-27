import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { checkedArguments, schemaHash, systemPrompt } from "../lib/tool-registry.mjs";

const dir = new URL("../training/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", dir)));
const groups = JSON.parse(await readFile(new URL("local/groups.json", dir)));
const all = new Map();
const groupOwners = new Map();
const normalize = (value) => value.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const tokenize = (text) => new Set(normalize(text).split(/\s+/).filter((token) => token.length > 2));
const similarity = (a, b) => [...a].filter((token) => b.has(token)).length / new Set([...a, ...b]).size;
assert.equal(manifest.schemaHash, schemaHash);
assert.equal((await readFile(new URL("local/holdout.sha256", dir), "utf8")).trim(), manifest.sha256["local/holdout.jsonl"]);
for (const [file, hash] of Object.entries(manifest.sha256)) {
  const data = await readFile(new URL(file, dir));
  assert.equal(createHash("sha256").update(data).digest("hex"), hash, file);
}
for (const [split, total, file] of [
  ["train", 300, "vendor-candidate/train.jsonl"], ["test", 60, "vendor-candidate/test.jsonl"], ["holdout", 100, "local/holdout.jsonl"],
]) {
  const rows = (await readFile(new URL(file, dir), "utf8")).trimEnd().split("\n").map(JSON.parse);
  assert.equal(rows.length, total);
  rows.forEach(({ messages }, i) => {
    assert.equal(messages[0].content, systemPrompt);
    const { request } = JSON.parse(messages[1].content);
    const call = messages[2].tool_calls;
    assert.equal(call.length, 1);
    assert.equal(checkedArguments(call[0].function.name, call[0].function.arguments), true);
    assert.equal(request, groups[split][i].text);
    const group = groups[split][i].group;
    assert.ok(!groupOwners.has(group) || groupOwners.get(group) === split);
    groupOwners.set(group, split);
    const key = normalize(request);
    assert.ok(!all.has(key), "Duplicate text: " + groups[split][i].id);
    const tokens = tokenize(request);
    for (const sample of all.values()) {
      if (sample.split !== split) assert.ok(similarity(tokens, sample.tokens) < 0.82,
        "Near duplicate across sets: " + groups[split][i].id + " / " + sample.id);
    }
    all.set(key, { split, tokens, id: groups[split][i].id });
  });
  const controlRatio = manifest.counts[split].controls / total;
  assert.ok(controlRatio >= 0.15 && controlRatio <= 0.20);
}
console.log("Verified manifest hashes, 460 unique labels, group isolation and cross-split lexical leakage threshold.");
