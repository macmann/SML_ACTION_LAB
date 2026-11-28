// Update the required release version when appending a new migration.
export const requiredSchemaVersion = 5;

export function hasMigrationRegistry(registry: readonly { version: number; sql: string }[]) {
  return registry.length === requiredSchemaVersion &&
    registry.every(({ version, sql }, index) => version === index + 1 && sql.trim().length > 0);
}

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
}, {
  version: 2,
  sql: `
ALTER TABLE slm_workspace.inference_logs
  ADD COLUMN mode text,
  ADD COLUMN routing_profile jsonb,
  ADD COLUMN writing_profile jsonb,
  ADD COLUMN provider_identity text,
  ADD COLUMN writer_identity text,
  ADD COLUMN predicted_tool text,
  ADD COLUMN validation_status text,
  ADD COLUMN execution_status text,
  ADD COLUMN routing_ms integer,
  ADD COLUMN execution_ms integer,
  ADD COLUMN writer_ms integer,
  ADD COLUMN writer_status text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE slm_workspace.approvals
  ADD COLUMN idempotency_key uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  ADD COLUMN schema_version text NOT NULL DEFAULT 'legacy',
  ADD COLUMN proposal_hash text NOT NULL DEFAULT 'legacy',
  ADD COLUMN database_generation integer NOT NULL DEFAULT 0,
  ADD COLUMN expires_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN outcome jsonb,
  ADD CONSTRAINT approvals_status CHECK (status IN ('pending','approved','executing','succeeded','failed','expired'));
CREATE UNIQUE INDEX tool_execution_single_claim ON slm_workspace.tool_executions(approval_id) WHERE approval_id IS NOT NULL;
CREATE FUNCTION slm_workspace.guard_approval() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
  IF (NEW.id, NEW.idempotency_key, NEW.request, NEW.schema_version, NEW.proposal_hash, NEW.database_generation, NEW.expires_at, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.idempotency_key, OLD.request, OLD.schema_version, OLD.proposal_hash, OLD.database_generation, OLD.expires_at, OLD.created_at)
  THEN RAISE EXCEPTION 'Immutable approval proposal'; END IF;
  IF NOT ((OLD.status = 'pending' AND NEW.status IN ('approved','expired')) OR
    (OLD.status = 'approved' AND NEW.status IN ('executing','expired')) OR
    (OLD.status = 'executing' AND NEW.status IN ('succeeded','failed')))
  THEN RAISE EXCEPTION 'Invalid approval transition'; END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER approval_guard BEFORE UPDATE ON slm_workspace.approvals
FOR EACH ROW EXECUTE FUNCTION slm_workspace.guard_approval();
`,
}, {
  version: 3,
  sql: `
CREATE TABLE slm_workspace.document_derivations (
  document_id uuid PRIMARY KEY,
  source_id uuid NOT NULL,
  source_hash text NOT NULL,
  version integer NOT NULL CHECK (version > 1),
  UNIQUE(source_id, version)
);
CREATE TABLE slm_workspace.template_invoice_numbers (
  number text PRIMARY KEY
);
`,
}, {
  version: 4,
  sql: `
ALTER TABLE slm_workspace.tasks ADD COLUMN origin_approval uuid, ADD COLUMN evidence jsonb,
  ADD COLUMN source_invoice uuid REFERENCES slm_workspace.invoices ON DELETE SET NULL;
CREATE UNIQUE INDEX tasks_approval_title ON slm_workspace.tasks(origin_approval, lower(title)) WHERE origin_approval IS NOT NULL;
ALTER TABLE slm_workspace.invoices ADD COLUMN customer text, ADD COLUMN due_on date,
  ADD COLUMN amount numeric(20,6), ADD COLUMN tax numeric(20,6),
  ADD COLUMN source_document uuid REFERENCES slm_workspace.documents ON DELETE SET NULL,
  ADD COLUMN verified boolean NOT NULL DEFAULT false, ADD COLUMN revision integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT invoice_workflow_status CHECK (status IN ('imported','draft','unpaid','paid'));
UPDATE slm_workspace.invoices SET status='imported' WHERE status='draft' AND NOT verified;
CREATE TABLE slm_workspace.expenses (
  id uuid PRIMARY KEY, description text NOT NULL, incurred_on date NOT NULL,
  amount numeric(20,6) NOT NULL CHECK (amount >= 0), currency text NOT NULL
);
CREATE TABLE slm_workspace.invoice_workflows (
  id uuid PRIMARY KEY, source_invoice uuid NOT NULL REFERENCES slm_workspace.invoices,
  draft_invoice uuid REFERENCES slm_workspace.invoices, email_draft text,
  stage text NOT NULL CHECK (stage IN ('awaiting_copy','copied','drafted','completed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
`,
}, {
  version: 5,
  sql: `
CREATE TABLE slm_workspace.arena_batches (
  id uuid PRIMARY KEY, request_cap integer NOT NULL CHECK (request_cap BETWEEN 1 AND 8),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE slm_workspace.arena_vendor_metrics (
  id uuid PRIMARY KEY, variant text NOT NULL CHECK (variant IN ('base','tuned')),
  source text NOT NULL, samples integer NOT NULL CHECK (samples > 0),
  correct integer NOT NULL CHECK (correct BETWEEN 0 AND samples),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE slm_workspace.arena_reviews (
  run_id uuid PRIMARY KEY REFERENCES slm_workspace.benchmark_runs(id),
  faithfulness integer NOT NULL CHECK (faithfulness BETWEEN 0 AND 3),
  notes text NOT NULL, reviewed_at timestamptz NOT NULL DEFAULT now()
);
`,
}];
