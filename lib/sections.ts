export const sections = {
  assistant: { title: "Assistant", description: "Assistant requests will be available after model provider configuration is implemented." },
  documents: { title: "Documents", description: "Document upload, conversion, and local search are planned for a later phase." },
  tasks: { title: "Tasks / Notes", description: "Task and note storage will be available after PostgreSQL setup." },
  invoices: { title: "Invoices", description: "Invoice workflows are planned for a later phase." },
  "model-arena": { title: "Model Arena", description: "Model comparisons require a configured provider. This release makes no model calls." },
  logs: { title: "Logs", description: "Structured activity history is planned for a later phase. Container startup diagnostics are available in Coolify." },
  settings: { title: "Settings", description: "Manage runtime configuration and preferences." },
};

export function isSection(section: string): section is keyof typeof sections {
  return Object.hasOwn(sections, section);
}
