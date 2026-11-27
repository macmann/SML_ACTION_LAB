"use client";

import { useActionState } from "react";
import { changePassword } from "@/app/actions";
import { updateSettings } from "@/app/settings-actions";
import { Button } from "@/components/ui/button";


export function SettingsForm({ operation, revision, children, submit }: {
  operation: string; revision: number; children?: React.ReactNode; submit: string;
}) {
  const [result, action, pending] = useActionState(operation === "password" ? changePassword : updateSettings, "");
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="operation" value={operation} />
      <input type="hidden" name="revision" value={revision} />
      {children}
      {result && <p role="status" className="text-sm">{result}</p>}
      <Button disabled={pending} className="justify-self-start">{pending ? "Working…" : submit}</Button>
    </form>
  );
}
