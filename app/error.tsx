"use client";

import { AuthPanel } from "@/components/auth-panel";
import { Button } from "@/components/ui/button";

export default function ApplicationError({ reset }: { reset: () => void }) {
  return (
    <AuthPanel title="Unable to open the workspace">
      <p className="text-[var(--muted)]">Retry the request. If the problem continues, check the app container logs and data volume.</p>
      <Button onClick={reset}>Try again</Button>
    </AuthPanel>
  );
}
