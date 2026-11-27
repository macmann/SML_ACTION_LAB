// Append a migration for schema changes. Existing migration checksums are persisted.
export const migrations = [{
  version: 1,
  sql: `
CREATE TABLE slm_workspace.installation (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  id uuid NOT NULL UNIQUE
);
CREATE TABLE slm_workspace.documents (
  id uuid PRIMARY KEY,
  filename text NOT NULL,
  title text NOT NULL,
  media_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  tags text[] NOT NULL DEFAULT '{}',
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  document_date date,
  extraction_status text NOT NULL CHECK (extraction_status IN ('extracted', 'no_text'))
);
CREATE INDEX documents_uploaded ON slm_workspace.documents (uploaded_at DESC, id);
CREATE TABLE slm_workspace.document_contents (
  document_id uuid NOT NULL REFERENCES slm_workspace.documents ON DELETE CASCADE,
  ordinal integer NOT NULL,
  reference text NOT NULL,
  body text NOT NULL,
  PRIMARY KEY (document_id, ordinal)
);
CREATE TABLE slm_workspace.document_versions (
  document_id uuid NOT NULL REFERENCES slm_workspace.documents ON DELETE CASCADE,
  version integer NOT NULL,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, version)
);
CREATE TABLE slm_workspace.active_attachments (
  document_id uuid PRIMARY KEY REFERENCES slm_workspace.documents ON DELETE CASCADE
);
CREATE TABLE slm_workspace.conversations (
  id uuid PRIMARY KEY, title text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE slm_workspace.messages (
  id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES slm_workspace.conversations ON DELETE CASCADE,
  role text NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE slm_workspace.tasks (
  id uuid PRIMARY KEY, title text NOT NULL, status text NOT NULL DEFAULT 'open', due_on date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE slm_workspace.notes (
  id uuid PRIMARY KEY, title text NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE slm_workspace.invoices (
  id uuid PRIMARY KEY, invoice_number text NOT NULL UNIQUE, currency text NOT NULL,
  status text NOT NULL DEFAULT 'draft', issued_on date
);
CREATE TABLE slm_workspace.invoice_items (
  id uuid PRIMARY KEY, invoice_id uuid NOT NULL REFERENCES slm_workspace.invoices ON DELETE CASCADE,
  description text NOT NULL, quantity numeric NOT NULL, unit_price numeric NOT NULL
);
CREATE TABLE slm_workspace.approvals (
  id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'pending', request jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE slm_workspace.tool_executions (
  id uuid PRIMARY KEY, approval_id uuid REFERENCES slm_workspace.approvals, tool text NOT NULL,
  status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE slm_workspace.inference_logs (
  id uuid PRIMARY KEY, provider text NOT NULL, model text NOT NULL, status text NOT NULL,
  duration_ms integer, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE slm_workspace.benchmark_cases (
  id uuid PRIMARY KEY, title text NOT NULL, input jsonb NOT NULL
);
CREATE TABLE slm_workspace.benchmark_runs (
  id uuid PRIMARY KEY, case_id uuid NOT NULL REFERENCES slm_workspace.benchmark_cases,
  model text NOT NULL, result jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE slm_workspace.application_preferences (
  key text PRIMARY KEY, value jsonb NOT NULL
);
`,
}];
