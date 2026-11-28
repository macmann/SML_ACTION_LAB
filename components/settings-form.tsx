"use client";

import { useActionState, useEffect, useEffectEvent } from "react";
import { changePassword } from "@/app/actions";
import { updateSettings } from "@/app/settings-actions";
import { Button } from "@/components/ui/button";


export function SettingsForm({ operation, revision, children, submit, onResult }: {
  operation: string; revision: number; children?: React.ReactNode; submit: string; onResult?: () => void;
}) {
  const [result, action, pending] = useActionState(operation === "password" ? changePassword : updateSettings, "");
  const notify = useEffectEvent(() => onResult?.());
  useEffect(() => {
    if (result && !pending && operation === "migrate") {
      window.dispatchEvent(new Event("slm-workspace-refresh"));
      notify();
    }
  }, [operation, pending, result]);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="operation" value={operation} />
      <input type="hidden" name="revision" value={revision} />
      {children}
      {result && <p role="status" className="text-sm">{result}</p>}
      <Button disabled={pending} className="justify-self-start">{pending ? operation === "migrate" ? "Migrations in progress…" : "Working…" : submit}</Button>
    </form>
  );
}
