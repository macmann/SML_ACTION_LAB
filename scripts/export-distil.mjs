import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { actionTools, controlTools, wireTools, checkedArguments, schemaHash, schemaVersion, systemPrompt } from "../lib/tool-registry.mjs";
import { families, scenario } from "../training/scenarios.mjs";

const directory = new URL("../training/", import.meta.url).pathname;
const samples = {};
const digest = (value) => createHash("sha256").update(value).digest("hex");
for (const [split, family] of Object.entries(families)) {
  samples[split] = wireTools.flatMap(({ function: { name } }, index) => Array.from({
    length: index < actionTools.length ? family.count : family.controls,
  }, (_, i) => {
    const { request, active, args, group } = scenario(split, name, i);
    if (!checkedArguments(name, args)) throw new Error("Invalid label: " + group + "/" + i);
    const id = split + "-" + name + "-" + (i + 1);
    return { id, group, messages: [{ role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify({ request, active_documents: active }) },
      { role: "assistant", tool_calls: [{ id: "call_" + i, type: "function", function: { name, arguments: args } }] }] };
  }));
}
const counts = Object.fromEntries(Object.entries(samples).map(([split, rows]) => [split, {
  rows: rows.length, controls: rows.filter((row) => controlTools.some((tool) => tool.function.name === row.messages[2].tool_calls[0].function.name)).length,
  byTool: Object.fromEntries(wireTools.map(({ function: { name } }) => [name, rows.filter((row) => row.messages[2].tool_calls[0].function.name === name).length])),
}]));
const lines = (rows) => rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
const vendor = (rows) => lines(rows.map(({ messages }) => ({ messages, tools: wireTools })));
const files = {
  "vendor-candidate/train.jsonl": vendor(samples.train),
  "vendor-candidate/test.jsonl": vendor(samples.test),
  "local/holdout.jsonl": lines(samples.holdout),
  "local/groups.json": JSON.stringify(Object.fromEntries(Object.entries(samples).map(([split, rows]) =>
    [split, rows.map(({ id, group, messages }) => ({ id, group, text: JSON.parse(messages[1].content).request }))])), null, 2) + "\n",
  // Candidate settings are kept separate from the locked holdout and never submitted by this script.
  "vendor-candidate/config.yaml": "# Candidate only. Verify exact fields against the current Distil CLI before upload.\n" +
    "task: chat-completion\nstudent: Qwen3-0.6B\nteacher: openai.gpt-oss-120b\njudge: openai.gpt-oss-120b\n" +
    "thinking: false\nlora_rank: 16\nsft_epochs: 4\nrlvr: false\ntrain: train.jsonl\ntest: test.jsonl\n",
  "vendor-candidate/job_description.json": JSON.stringify({
    verification: "unverified_vendor_configuration", schema_version: schemaVersion, schema_hash: schemaHash,
    system_prompt: systemPrompt, tools: wireTools,
    description: "Route fictional document-workspace requests to exactly one native action or control tool.",
    task: "chat-completion", base_model: "Qwen3-0.6B", teacher: "openai.gpt-oss-120b", judge: "openai.gpt-oss-120b",
    thinking: false, lora_rank: 16, sft_epochs: 4, rlvr: false,
  }, null, 2) + "\n",
};
const lockedHoldout = (await readFile(join(directory, "local/holdout.sha256"), "utf8")).trim();
if (lockedHoldout !== digest(files["local/holdout.jsonl"])) {
  throw new Error("The holdout is locked. Use a separately versioned dataset for changed final examples.");
}
files["manifest.json"] = JSON.stringify({
  version: 1, schemaVersion, schemaHash, vendorCompatibility: "unverified", counts,
  sha256: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, digest(content)])),
}, null, 2) + "\n";
for (const [name, content] of Object.entries(files)) {
  if (process.argv.includes("--check")) {
    if (await readFile(join(directory, name), "utf8") !== content) throw new Error("Regenerate " + name);
  } else {
    await mkdir(join(directory, name.split("/")[0] === name ? "." : name.split("/")[0]), { recursive: true });
    await writeFile(join(directory, name), content);
  }
}
console.log("Verified labeled counts:", JSON.stringify(counts));
