import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { sign } from "node:crypto";

const canonical = (value) => Array.isArray(value) ? "[" + value.map(canonical).join(",") + "]" :
  value && typeof value === "object" ? "{" + Object.keys(value).sort()
    .map((key) => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}" : JSON.stringify(value);

const signingKey = readFileSync("/fixture/model-key.pem");
const send = (res, value) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(value));
const call = (name, args) => ({ id: "fixture-call", type: "function", function: { name, arguments: JSON.stringify(args) } });
const task = call("create_tasks_from_document", { source_query: "@active:1" });

async function complete(req, res) {
  let raw = "";
  for await (const part of req) {
    raw += part.toString();
    if (raw.length > 100_000) return res.writeHead(413).end();
  }
  const input = JSON.parse(raw);
  const payload = JSON.parse(input.messages[1].content);
  if (input.messages.length !== 2 || input.messages[1].role !== "user" || input.messages[0].role !== "system") return res.writeHead(400).end();
  if (!input.tools) {
    if (payload.sections) {
      const section = payload.sections[0];
      return send(res, { model: "fixture", choices: [{ finish_reason: "stop", message: {
        role: "assistant", content: JSON.stringify([{ ref: section.id, quote: "UNTRUSTED-DOCUMENT-DATA" }]),
      } }] });
    }
    if (!payload.source.includes("UNTRUSTED-DOCUMENT-DATA") || payload.source.length > 8000) return res.writeHead(400).end();
    if (payload.instruction.includes("malicious")) {
      return send(res, { model: "fixture", choices: [{ finish_reason: "tool_calls", message: { role: "assistant", tool_calls: [task] } }] });
    }
    return send(res, { model: "fixture", choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Fictional writer draft." } }] });
  }
  if (input.tools.length !== 12 || input.parallel_tool_calls !== false || input.n !== 1 ||
      Object.keys(payload).sort().join(",") !== "active_documents,request" ||
      input.messages[1].content.includes("UNTRUSTED-DOCUMENT-DATA")) return res.writeHead(400).end();
  const request = payload.request;
  if (request === "fixture timeout") return;
  if (request === "fixture plain text") return send(res, { model: "fixture",
    choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(task) } }] });
  const calls = {
    "fixture multiple": [task, task],
    "fixture unknown tool": [call("run_shell", { command: "fixture" })],
    "fixture malicious arguments": [call("search_documents", { query: "QZ-381", path: "/fixture", url: "https://invalid.example" })],
    "fixture unsupported": [call("unsupported_intent", { reason: "That request is outside the profile." })],
    "fixture clarify": [call("clarification_required", { question: "Which source should I use?" })],
    "fixture search QZ-381": [call("search_documents", { query: "QZ-381" })],
    "fixture ambiguous QZ-381": [call("extract_document_fields", { source_query: "QZ-381", fields: ["invoice_id"] })],
    "fixture extract": [call("extract_document_fields", { source_query: "@active:1", fields: ["invoice_id", "customer", "amount"] })],
    "fixture compare": [call("compare_documents", { left_query: "@active:1", right_query: "Other source.txt" })],
    "fixture analyze": [call("analyze_spreadsheet", { source_query: "Fixture table.csv", group_by: "Group", metric: "Amount", operation: "sum" })],
    "fixture report": [call("generate_report", { report_type: "task_status", filters: { task_status: "open" } })],
    "fixture writer without selected source": [call("draft_email", { source_query: "Assistant fixture.txt", purpose: "Draft a fictional reply" })],
    "fixture draft": [call("draft_email", { source_query: "@active:1", purpose: "Draft a fictional reply", tone: "neutral" })],
    "fixture malicious writer": [call("draft_email", { source_query: "@active:1", purpose: "malicious" })],
    "fixture long summary": [call("search_and_summarize", { query: "@active:1" })],
    "fixture summary": [call("search_and_summarize", { query: "@active:1", summary_style: "brief" })],
    "fixture duplicate 2025-02": [call("duplicate_document", { source_query: "@active:1", target_period: "2025-02", preserve_amount: true, preserve_customer: true })],
    "fixture invented period": [call("duplicate_document", { source_query: "@active:1", target_period: "2025-02", preserve_amount: true, preserve_customer: true })],
    'fixture replace "17" with "23"': [call("modify_and_convert", { source_query: "@active:1", replacements: [{ find: "17", replace: "23" }], output_format: "pdf" })],
    "fixture tasks": [task],
    "fixture fallback": [task],
    "fixture mismatch": [task],
  }[request] ?? [call("unsupported_intent", { reason: "Unknown fictional fixture." })];
  const choice = { finish_reason: "tool_calls", message: { role: "assistant", tool_calls: calls } };
  const response = { model: request === "fixture mismatch" ? "other-model" : "fixture", choices: [choice] };
  const challenge = req.headers["slm-challenge"];
  const profileId = req.headers["slm-profile"];
  if (challenge && profileId) {
    const signature = sign(null, Buffer.from(canonical({ version: 1, challenge, profileId, model: response.model, choice })), signingKey);
    response.slm_attestation = { signature: signature.toString("base64url") };
  }
  if (request === "fixture fallback") response.fallback = true;
  return send(res, response);
}

createServer({
  cert: readFileSync("/fixture/cert.pem"),
  key: readFileSync("/fixture/key.pem"),
}, (req, res) => {
  if (req.headers.authorization !== "Bearer " + process.env.SLM_TEST_PROVIDER_KEY) return res.writeHead(401).end();
  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    void complete(req, res).catch(() => res.writeHead(400).end());
    return;
  }
  if (req.method !== "GET") return res.writeHead(404).end();
  if (req.url === "/redirect/models/fixture") {
    return res.writeHead(302, { Location: "https://model-fixture:8443/v1/models/fixture" }).end();
  }
  if (req.url === "/v1/models/fixture") return send(res, { id: "fixture" });
  res.writeHead(404).end();
}).listen(8443, "0.0.0.0");
