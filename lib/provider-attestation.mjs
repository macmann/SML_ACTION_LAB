import { verify } from "node:crypto";
import { canonical } from "./tool-registry.mjs";

// The signature binds the configured profile, a fresh challenge, and the exact first choice.
export function attestationPayload(challenge, profileId, model, choice) {
  return Buffer.from(canonical({ version: 1, challenge, profileId, model, choice }));
}

export function identityOf(profile, challenge, response) {
  const key = profile.provenance?.attestationPublicKey;
  const signature = response?.slm_attestation?.signature;
  if (profile.role !== "distil" || !key || !challenge ||
      response?.model !== profile.model || (response?.fallback != null && response.fallback !== false) ||
      (response?.slm_attestation?.fallback != null && response.slm_attestation.fallback !== false) || response?.choices?.length !== 1 ||
      typeof signature !== "string" || !/^[\w-]{86}$/.test(signature)) return "unverified";
  try {
    const valid = verify(null, attestationPayload(challenge, profile.id, response.model, response.choices[0]),
      key, Buffer.from(signature, "base64url"));
    return valid ? "attested" : "unverified";
  } catch {
    return "unverified";
  }
}
