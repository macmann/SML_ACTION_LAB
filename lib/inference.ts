import { randomBytes } from "node:crypto";
import { store } from "./bootstrap.mjs";
import { WorkspaceError } from "./database";
import { modelProfile, type ModelProfile } from "./model-profile";
import { providerJson } from "./probes";
import { defaultPreferences, type Role, type Settings } from "./settings";
import { identityOf } from "./provider-attestation.mjs";
import { wireTools } from "./tool-registry.mjs";

const capacity = globalThis as typeof globalThis & { slmInference?: { used: number[]; active: number } };
const limits = capacity.slmInference ??= { used: [], active: 0 };
export type Mode = "strict" | "comparison" | "model_only";

export function configuredProfile(settings: Settings, role: Role) {
  const provider = settings[role];
  if (!provider || settings.providerChoice === "skipped" && role === "distil") {
    throw new WorkspaceError("Configure and enable the selected provider in Settings.", 503);
  }
  return modelProfile(role, provider.model, settings.routingProfile);
}

async function completion(settings: Settings, profile: ModelProfile, message: string, challenge?: string) {
  const provider = settings[profile.role];
  if (!provider || provider.model !== profile.model) throw new WorkspaceError("The model profile is no longer available.", 409);
  const now = Date.now();
  limits.used = limits.used.filter((stamp) => now - stamp < 60_000);
  if (limits.active >= 2 || limits.used.length >= (settings.preferences ?? defaultPreferences).requestsPerMinute) {
    throw new WorkspaceError("The inference rate limit was reached. Retry shortly.", 429);
  }
  limits.active++;
  limits.used.push(now);
  try {
    const endpoint = await store.decrypt(profile.role + ".endpoint", provider.endpoint);
    const key = provider.key ? await store.decrypt(profile.role, provider.key) : "";
    return await providerJson({ endpoint, key, custom: provider.custom, privateNetwork: provider.privateNetwork }, {
      path: "/chat/completions", timeout: 9_000,
      headers: challenge ? { "Slm-Challenge": challenge, "Slm-Profile": profile.id } : undefined,
      body: {
        model: profile.model,
        messages: [{ role: "system", content: profile.systemPrompt }, { role: "user", content: message }],
        temperature: profile.sampling.temperature, top_p: profile.sampling.topP,
        max_completion_tokens: profile.sampling.maxCompletionTokens, n: 1,
        ...(profile.role === "writer" ? {} : { tools: wireTools, tool_choice: "required", parallel_tool_calls: false }),
        ...(profile.thinking === "on" ? { chat_template_kwargs: { enable_thinking: true } } : {}),
      },
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new WorkspaceError("The selected provider timed out. No fallback was used.", 504);
    }
    throw new WorkspaceError("The selected provider failed. No fallback was used.", 502);
  } finally { limits.active--; }
}

export async function routeTurn(settings: Settings, profile: ModelProfile, request: string, activeCount: number) {
  const challenge = profile.provenance?.attestationPublicKey ? randomBytes(24).toString("base64url") : undefined;
  const response = await completion(settings, profile, JSON.stringify({
    request, active_documents: Array.from({ length: activeCount }, (_, index) => "@active:" + (index + 1)),
  }), challenge);
  return { response, identity: identityOf(profile, challenge, response) };
}

export async function writeContent(settings: Settings, profile: ModelProfile,
  input: { action: string; instruction: string; source: string }) {
  const response = await completion(settings, profile, JSON.stringify({ action: input.action, instruction: input.instruction, source: input.source.slice(0, 8000) }));
  if (!response || typeof response !== "object" || !("choices" in response) || !Array.isArray(response.choices) ||
      response.choices.length !== 1 || response.choices[0]?.finish_reason !== "stop" ||
      response.choices[0]?.message?.role !== "assistant" || response.choices[0].message.tool_calls?.length || response.choices[0].message.function_call != null ||
      typeof response.choices[0]?.message?.content !== "string" || !response.choices[0].message.content.trim() || response.choices[0].message.content.length > 8000) {
    throw new WorkspaceError("The writer did not return a complete text draft.", 502);
  }
  return response.choices[0].message.content.trim();
}
