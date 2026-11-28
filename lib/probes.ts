import { z } from "zod";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { checkServerIdentity } from "node:tls";
import ipaddr from "ipaddr.js";
import pg from "pg";

const timeout = 4000;

class EndpointPolicyError extends Error {}
class UpstreamStatusError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("Unexpected upstream HTTP status.");
    this.status = status;
  }
}
class InvalidProviderResponse extends Error {}

export class ProviderValidationError extends Error {
  httpStatus?: number;
  stage?: string;
}
export function providerHttpStatus(error: unknown) {
  return error instanceof UpstreamStatusError ? error.status :
    error instanceof ProviderValidationError ? error.httpStatus : undefined;
}

export function allowedAddress(address: string, privateNetwork: boolean) {
  const ip = ipaddr.process(address);
  const normalized = ip.toString();
  if (normalized === "168.63.129.16" || normalized === "fd00:ec2::254") return false;
  const range = ip.range();
  return range === "unicast" || (privateNetwork && (range === "private" || range === "uniqueLocal"));
}

async function resolve(host: string, privateNetwork: boolean) {
  if (["metadata", "instance-data", "localhost"].includes(host) ||
    host.endsWith(".localhost") || host.startsWith("metadata.")) throw new EndpointPolicyError();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] :
      await Promise.race([
        lookup(host, { all: true, verbatim: true }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new DOMException("DNS resolution timed out.", "TimeoutError")), timeout); }),
      ]);
    if (!addresses.length || addresses.some(({ address }) => !allowedAddress(address, privateNetwork))) throw new EndpointPolicyError();
    return addresses[0];
  } finally {
    clearTimeout(timer);
  }
}

function hostname(url: URL) {
  const name = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!name || name.endsWith(".") || name.includes("%") || name.includes("/")) throw new Error();
  return name;
}

export async function databaseConnectionOptions(value: string): Promise<pg.ClientConfig> {
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.username || !url.password ||
      !/^\/[^/]+$/.test(url.pathname) || url.hash ||
      [...url.searchParams.keys()].some((key) => key !== "sslmode") || url.searchParams.getAll("sslmode").length > 1) {
    throw new Error();
  }
  const mode = url.searchParams.get("sslmode") ?? "verify-full";
  if (!["disable", "verify-full"].includes(mode)) throw new Error();
  const host = hostname(url);
  const { address } = await resolve(host, true);
  if (mode === "disable" && allowedAddress(address, false)) throw new Error();
  const credentials = [url.username, url.password, url.pathname.slice(1)].map(decodeURIComponent);
  if (credentials.some((field) => !field || field.includes("\0"))) throw new Error();
  return {
    host: address, port: Number(url.port || 5432),
    user: credentials[0], password: credentials[1], database: credentials[2],
    ssl: mode === "disable" ? false : {
      rejectUnauthorized: true, servername: isIP(host) ? undefined : host,
      checkServerIdentity: (_name, cert) => checkServerIdentity(host, cert),
    },
    connectionTimeoutMillis: timeout, query_timeout: timeout + 1000, statement_timeout: timeout,
    lock_timeout: 2500, idle_in_transaction_session_timeout: 10000, application_name: "slm_action_lab",
  };
}

export async function testDatabase(value: string) {
  const client = new pg.Client(await databaseConnectionOptions(value));
  client.on("error", () => { /* Connection errors are surfaced through the probe promise. */ });
  try {
    await client.connect();
    await client.query("SELECT 1");
  } finally {
    await client.end();
  }
}

type Transport = { endpoint: string; key: string; custom: boolean; privateNetwork: boolean };
type ProviderRequest = { path: string; body?: object; headers?: Record<string, string>; timeout?: number };

export function endpointPolicy(endpoint: string, custom: boolean, privateNetwork: boolean) {
  let url: URL;
  let host: string;
  try { url = new URL(endpoint); host = hostname(url); }
  catch { throw new EndpointPolicyError(); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      (!custom && (host !== "api.openai.com" || url.port || url.pathname.replace(/\/$/, "") !== "/v1")) ||
      (privateNetwork && !custom)) throw new EndpointPolicyError();
  return { url, host };
}

export async function testEndpointPolicy(endpoint: string, custom: boolean, privateNetwork: boolean) {
  const { host } = endpointPolicy(endpoint, custom, privateNetwork);
  await resolve(host, privateNetwork);
}

export async function providerJson(provider: Transport, input: ProviderRequest): Promise<unknown> {
  const { endpoint, key, custom, privateNetwork } = provider;
  const { url, host } = endpointPolicy(endpoint, custom, privateNetwork);
  const { address, family } = await resolve(host, privateNetwork);
  url.pathname = url.pathname.replace(/\/+$/, "") + input.path;
  const body = input.body ? JSON.stringify(input.body) : undefined;
  return new Promise<unknown>((resolve, reject) => {
    const probe = request(url, {
      method: body ? "POST" : "GET",
      agent: false,
      family,
      lookup: (_host, _options, callback) => callback(null, address, family),
      headers: {
        Accept: "application/json",
        ...(key ? { Authorization: "Bearer " + key } : {}),
        ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}),
        ...input.headers,
      },
      signal: AbortSignal.timeout(input.timeout ?? timeout),
    }, (response) => {
      if (response.statusCode !== 200) {
        reject(response.statusCode ? new UpstreamStatusError(response.statusCode) : new InvalidProviderResponse());
        response.destroy();
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("error", reject);
      response.on("aborted", () => reject(new Error()));
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 96 * 1024) {
          reject(new InvalidProviderResponse());
          response.destroy();
        } else chunks.push(chunk);
      });
      response.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { reject(new InvalidProviderResponse()); }
      });
    });
    probe.on("error", reject);
    probe.end(body);
  });
}


export const validationModes = ["automatic", "discovery", "chat"] as const;
export type ValidationMode = typeof validationModes[number];
const noDiscovery = [404, 405, 501];
const chatResult = z.object({
  choices: z.array(z.object({
    message: z.object({
      role: z.literal("assistant"),
      content: z.string().nullish(),
      tool_calls: z.array(z.object({
        id: z.string().min(1), type: z.literal("function"),
        function: z.object({ name: z.string().min(1), arguments: z.string() }),
      })).optional(),
    }).refine((message) => Boolean(message.content?.trim() || message.tool_calls?.length)),
  })).min(1),
});

function probeFailure(stage: string, error: unknown) {
  if (error instanceof UpstreamStatusError) {
    const status = error.status;
    const detail = status === 401 || status === 403 ? "Check the API key and its access to the model." :
      stage === "Model discovery" && noDiscovery.includes(status) ? "This model lookup is unavailable. Choose Chat Completion Test and allow the test request." :
      status >= 300 && status < 400 ? "Redirects are blocked. Enter the final HTTPS base URL." :
      status === 400 || status === 404 || status === 422 ? "Check the base URL and exact model ID." :
      status === 429 ? "The provider is rate limiting requests. Retry later." : "Check the provider's status and retry.";
    return Object.assign(new ProviderValidationError(`${stage} failed (HTTP ${status}). ${detail}`), { httpStatus: status, stage });
  }
  if (error instanceof EndpointPolicyError) return new ProviderValidationError(
    `${stage} blocked by endpoint policy. Use an allowed HTTPS address and enable custom endpoints when needed.`);
  if (error instanceof InvalidProviderResponse) return Object.assign(new ProviderValidationError(
    `${stage} returned an invalid or oversized response (HTTP 200).`), { httpStatus: 200, stage });
  if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) return new ProviderValidationError(
    `${stage} timed out. Check network access from the app container and retry.`);
  return new ProviderValidationError(`${stage} could not connect. Check DNS, outbound HTTPS, and the endpoint certificate.`);
}

export async function testProvider(endpoint: string, model: string, key: string, custom: boolean, privateNetwork: boolean,
  mode: ValidationMode = "automatic", consent = false) {
  if (!/^[\w][\w./:-]{0,159}$/.test(model)) {
    throw new ProviderValidationError("Model ID is invalid. Enter the exact model ID or deployment name.");
  }
  const provider = { endpoint, key, custom, privateNetwork };
  let discoveryStatus: number | undefined;
  if (mode !== "chat") {
    try {
      const result = await providerJson(provider, { path: "/models/" + encodeURIComponent(model) });
      if (!result || typeof result !== "object" || !("id" in result) || result.id !== model) {
        throw Object.assign(new ProviderValidationError("Model discovery returned HTTP 200 without the exact configured model ID. Check the ID or choose Chat Completion Test."), { httpStatus: 200, stage: "Model discovery" });
      }
      return { method: "discovery" as const, httpStatus: 200 as const };
    } catch (error) {
      if (error instanceof ProviderValidationError) throw error;
      if (mode !== "automatic" || !(error instanceof UpstreamStatusError) || !noDiscovery.includes(error.status)) {
        throw probeFailure("Model discovery", error);
      }
      discoveryStatus = error.status;
    }
  }
  if (!consent) {
    throw Object.assign(new ProviderValidationError(discoveryStatus
      ? `Model discovery is unavailable (HTTP ${discoveryStatus}). Allow the chat completion test and submit again to verify the model ID.`
      : "Allow the chat completion test before submitting. The provider may charge for this request."), { httpStatus: discoveryStatus, stage: "Consent" });
  }
  try {
    const result = await providerJson(provider, {
      path: "/chat/completions", timeout: 9000,
      body: { model, messages: [{ role: "user", content: "Reply with OK." }] },
    });
    if (!chatResult.safeParse(result).success) throw new InvalidProviderResponse();
    return { method: "chat" as const, httpStatus: 200 as const, discoveryStatus };
  } catch (error) {
    throw probeFailure("Chat completion test", error);
  }
}
