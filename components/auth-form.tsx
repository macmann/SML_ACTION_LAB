"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { claimInstance, signIn } from "@/app/actions";

const inputStyle = "block min-h-11 w-full rounded-md border border-[var(--line)] bg-[var(--page)] px-3 py-2";

export function AuthForm({ setup = false }: { setup?: boolean }) {
  const [error, action, pending] = useActionState(setup ? claimInstance : signIn, "");

  return (
    <form action={action} className="grid gap-4">
      {setup && (
        <label className="grid gap-2 text-sm font-medium">
          Pairing token
          <input name="code" type="password" required autoComplete="off" maxLength={64} className={inputStyle} />
        </label>
      )}
      <label className="grid gap-2 text-sm font-medium">
        {setup ? "Create an admin password" : "Admin password"}
        <input name="password" type="password" required minLength={12} maxLength={128}
          autoComplete={setup ? "new-password" : "current-password"} className={inputStyle}
          aria-describedby={setup ? "password-hint" : undefined} />
        {setup && <span id="password-hint" className="text-[var(--muted)]">Use 12 to 128 characters.</span>}
      </label>
      {error && <p role="alert" className="text-sm text-[var(--error)]">{error}</p>}
      <Button disabled={pending}>{pending ? (setup ? "Claiming…" : "Signing in…") : (setup ? "Claim instance" : "Sign in")}</Button>
    </form>
  );
}
