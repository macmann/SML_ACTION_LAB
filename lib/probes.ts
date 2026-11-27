import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { checkServerIdentity } from "node:tls";
import ipaddr from "ipaddr.js";
import pg from "pg";

const timeout = 4000;

export function allowedAddress(address: string, privateNetwork: boolean) {
  const ip = ipaddr.process(address);
  const normalized = ip.toString();
  if (normalized === "168.63.129.16" || normalized === "fd00:ec2::254") return false;
  const range = ip.range();
  return range === "unicast" || (privateNetwork && (range === "private" || range === "uniqueLocal"));
}

async function resolve(host: string, privateNetwork: boolean) {
  if (["metadata", "instance-data", "localhost"].includes(host) ||
    host.endsWith(".localhost") || host.startsWith("metadata.")) throw new Error();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] :
      await Promise.race([
        lookup(host, { all: true, verbatim: true }),
        new Promise<never>((_, reject) => { timer = setTimeout(reject, timeout); }),
      ]);
    if (!addresses.length || addresses.some(({ address }) => !allowedAddress(address, privateNetwork))) throw new Error();
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

export async function testProvider(endpoint: string, model: string, key: string, custom: boolean, privateNetwork: boolean) {
  const url = new URL(endpoint);
  const host = hostname(url);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      (!custom && (host !== "api.openai.com" || url.port || url.pathname.replace(/\/$/, "") !== "/v1")) ||
      (privateNetwork && !custom)) throw new Error();
  const { address, family } = await resolve(host, privateNetwork);
  const modelUrl = new URL(url);
  modelUrl.pathname = url.pathname.replace(/\/+$/, "") + "/models/" + encodeURIComponent(model);
  await new Promise<void>((resolve, reject) => {
    const probe = request(modelUrl, {
      method: "GET",
      agent: false,
      family,
      lookup: (_host, _options, callback) => callback(null, address, family),
      headers: key ? { Authorization: "Bearer " + key, Accept: "application/json" } : { Accept: "application/json" },
      signal: AbortSignal.timeout(timeout),
    }, (response) => {
      if (response.statusCode !== 200) {
        response.destroy();
        reject(new Error());
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("error", reject);
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 64 * 1024) response.destroy(new Error());
        else chunks.push(chunk);
      });
      response.on("end", () => {
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (payload.id !== model) throw new Error();
          resolve();
        } catch {
          reject(new Error());
        }
      });
    });
    probe.on("error", reject);
    probe.end();
  });
}
