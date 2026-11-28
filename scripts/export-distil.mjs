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
// Distil supplies the fixed system prompt and tool declarations from job_description.json.
const vendor = (rows) => lines(rows.map(({ messages }) => ({ messages: messages.slice(1) })));
const files = {
  "vendor-candidate/train.jsonl": vendor(samples.train),
  "vendor-candidate/test.jsonl": vendor(samples.test),
  "local/holdout.jsonl": lines(samples.holdout),
  "local/groups.json": JSON.stringify(Object.fromEntries(Object.entries(samples).map(([split, rows]) =>
    [split, rows.map(({ id, group, messages }) => ({ id, group, text: JSON.parse(messages[1].content).request }))])), null, 2) + "\n",
  "vendor-candidate/config.yaml": "base:\n  task: chat-completion\n  student_model_name: Qwen3-0.6B\n" +
    "  teacher_model_name: openai.gpt-oss-120b\n  enable_thinking: false\n  variable_system_prompt: false\n" +
    "tuning:\n  lora_r: 16\n  num_train_epochs: 4\n  rlvr_dataset_size: 0.0\n" +
    "evaluation:\n  llm_as_a_judge_model_name: openai.gpt-oss-120b\n" +
    "synthgen:\n  train_generation_target: 0\n  test_generation_target: 0\n",
  "vendor-candidate/job_description.json": JSON.stringify({
    task_description: systemPrompt,
    tools: wireTools,
    llm_as_a_judge_instructions: "Score good only if the prediction uses exactly one tool call with the correct action or control and all required information grounded in the request and context. Accept equivalent clarification wording and ignore argument key order. Score bad for extra calls, guessed facts, missing required information or an incorrect tool. Output <score>good</score> or <score>bad</score>.",
  }, null, 2) + "\n",
};
const lockedHoldout = (await readFile(join(directory, "local/holdout.sha256"), "utf8")).trim();
if (lockedHoldout !== digest(files["local/holdout.jsonl"])) {
  throw new Error("The holdout is locked. Use a separately versioned dataset for changed final examples.");
}
files["manifest.json"] = JSON.stringify({
  version: 1, schemaVersion, schemaHash, vendorCompatibility: "official_reference_checked_cli_unverified",
  vendorReference: "https://github.com/distil-labs/distil-cli-skill/tree/c012f4daec48e528818adcaa964dfadffa7bc998/skills/distil-cli", counts,
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
