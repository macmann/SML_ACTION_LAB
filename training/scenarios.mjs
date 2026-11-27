// Families are assigned before any wording or entity variation. Fictional names only.
export const families = {
  train: {
    count: 25, controls: 25, domain: "office",
    artifacts: ["binder", "closing memo", "dispatch register", "stock sheet", "supplier packet", "staff minutes",
      "handover log", "remittance", "billing note", "rate schedule", "project minutes", "purchase record",
      "equipment register", "warehouse ledger", "rent appendix", "internal audit", "meter statement", "pickup note",
      "client worksheet", "period checklist", "quarter ledger", "fleet record", "service form", "invoice copy", "route report"],
    places: ["Aster Quill", "Brindle Finch", "Marble Argo", "Coral Lantern", "Ivory Wren"],
    years: [2025, 2026],
  },
  test: {
    count: 5, controls: 5, domain: "field",
    artifacts: ["drone manifest", "observatory tally", "greenhouse log", "trail survey", "telescope checklist"],
    places: ["Jasper Observatory", "Zephyr Hothouse", "Nimbus Trail"],
    years: [2027, 2028],
  },
  holdout: {
    count: 8, controls: 10, domain: "community",
    artifacts: ["theater cue book", "library returns", "conservation diary", "craft fair roster",
      "studio proof", "choir minutes", "seed exchange", "aquarium tally"],
    places: ["Velvet Playhouse", "Tern Archive", "Moss Pavilion", "Loon Conservatory"],
    years: [2030, 2031],
  },
};

const types = ["csv", "pdf", "txt", "xlsx", "docx"];
const operations = ["sum", "count", "average", "min", "max"];
const styles = ["brief", "bullets", "detailed"];
const extraction = [["invoice_id", "amount"], ["reference"], ["customer", "currency"], ["due_date", "invoice_date"], ["supplier"]];
const tones = ["neutral", "formal", "friendly"];
const reports = ["document_inventory", "task_status"];
const pad = (i) => String(i).padStart(2, "0");

export function scenario(split, tool, i) {
  const f = families[split];
  const n = i % f.artifacts.length;
  const entity = f.places[i % f.places.length];
  const doc = entity + " " + f.artifacts[n];
  const older = doc + " archive";
  const period = f.years[i % f.years.length] + "-" + pad(i % 12 + 1);
  const date = period + "-" + pad(i % 26 + 1);
  const extension = types[i % types.length];
  const ref = i % 4 === 1 ? "@active:1" : doc;
  const active = ref === doc ? [] : ["@active:1"];
  const verb = ["Find", "Locate", "Search for", "Pull up", "List"][i % 5];
  const source = (raw) => raw === "@active:1" ? (i % 2 ? "the selected file" : "my active attachment") : raw;
  const choose = (office, field, community) => ({ office, field, community })[f.domain];
  const instruction = choose("check the handoff", "review the fieldwork", "prepare the community brief");
  const metric = choose("Units", "Samples", "Visitors");
  const group = choose("Team", "Station", "Venue");
  const groupBy = i % 2 ? { group_by: group } : {};
  let request, args;
  switch (tool) {
    case "search_documents":
      request = choose(
        i % 3 ? verb + " " + doc + " in " + extension.toUpperCase() + " files." : "Show " + doc + " from upload date " + date + " onward.",
        "For the site review, identify " + extension + " results tied to " + doc + ".",
        "Our coordinator needs the archive entry for " + doc + "; restrict the lookup to " + extension + ".");
      args = f.domain === "office" && i % 3 === 0 ? { query: doc, date_filter: { field: "uploaded", from: date } } : { query: doc, file_type: extension };
      break;
    case "search_and_summarize": {
      const style = styles[i % 3];
      request = choose("Summarize " + source(ref) + " (" + style + ") to " + instruction + ".",
        "I missed the inspection. Give a " + style + " summary of " + source(ref) + " for a site briefing.",
        "Turn " + source(ref) + " into a " + style + " digest for volunteers, focusing on the public program.");
      args = { query: ref, summary_style: style, ...(f.domain === "community" ? { focus: "the public program" } :
        f.domain === "office" ? { focus: instruction } : {}) };
      break;
    }
    case "duplicate_document":
      request = choose("Duplicate " + source(ref) + " for " + period + ". Keep the same customer and amount.",
        "Make a second draft from " + source(ref) + " for period " + period + "; carry over amount and customer unchanged.",
        "Archive a copy of " + source(ref) + " labeled " + period + " while preserving both billing amount and customer.");
      args = { source_query: ref, target_period: period, preserve_amount: true, preserve_customer: true };
      break;
    case "extract_document_fields": {
      const fields = extraction[i % 5];
      request = choose("Extract " + fields.join(" and ").replaceAll("_", " ") + " from " + source(ref) + ".",
        "From " + source(ref) + ", read only these labels: " + fields.join(", ") + ".",
        "For our records, tell me the labeled " + fields.join(" plus ").replaceAll("_", " ") + " in " + source(ref) + ".");
      args = { source_query: ref, fields };
      break;
    }
    case "compare_documents":
      request = choose("Compare " + source(ref) + " against " + older + " and show differences.",
        "Check for textual changes, inspection copy " + source(ref) + " versus the earlier " + older + ".",
        "What changed between " + source(ref) + " and " + older + " for the public record?");
      args = { left_query: ref, right_query: older };
      break;
    case "analyze_spreadsheet": {
      const operation = operations[i % 5];
      request = choose("Compute the " + operation + " of " + metric + " in " + source(ref),
        "From the field table " + source(ref) + ", calculate " + operation + " on column " + metric,
        "For our attendance check, work out " + operation + " for the " + metric + " column in " + source(ref)) +
        (i % 2 ? ", grouped by " + group + "." : ".");
      args = { source_query: ref, metric, operation, ...groupBy };
      break;
    }
    case "generate_report": {
      const report_type = reports[i % 2];
      const status = i % 4 === 1 ? "open" : "done";
      request = report_type === "task_status" ?
        choose("Generate a status report for " + status + " tasks.", "For the field briefing, report only tasks marked " + status + ".", "Create a volunteer task report, filtered to " + status + " tasks.") :
        choose("Generate a document inventory of " + extension + " files.", "For equipment handover I need an inventory of the " + extension + " documents.", "Prepare the community archive inventory for " + extension + " records.");
      request += choose([" For " + entity + " only in the current workspace.", " Use the local workspace.", " For the internal check."][i % 3],
        " Use this workspace.", " Use the shared workspace.");
      if (f.domain === "office" && request.includes(" only in the current workspace")) request = request.replace(" only in the current workspace", " briefing");
      args = { report_type, filters: report_type === "task_status" ? { task_status: status } : { file_type: extension } };
      break;
    }
    case "create_tasks_from_document":
      request = choose("Propose tasks from explicit TODO lines in " + source(ref) + ".",
        "Turn the marked next actions in " + source(ref) + " into proposed tasks that I can approve.",
        "Read the unchecked checklist in " + source(ref) + " and propose follow-up tasks for review.");
      args = { source_query: ref };
      break;
    case "draft_email": {
      const purpose = choose(["confirm receipt", "request a correction", "thank the supplier", "ask for an update", "request supporting details"][i % 5],
        "coordinate the next site visit", "invite volunteers to review the record");
      const tone = tones[i % 3];
      request = choose("Using " + source(ref) + ", draft a " + tone + " email to " + purpose + ".",
        "I need a " + tone + " fieldwork email with the purpose to " + purpose + ", based on " + source(ref) + ".",
        "For the community project, write a " + tone + " draft from " + source(ref) + " to " + purpose + ". Leave it unsent.");
      args = { source_query: ref, purpose, tone };
      break;
    }
    case "modify_and_convert": {
      const find = choose("Old marker", "Inspection pending", "Former venue") + " " + f.artifacts[n];
      const replace = choose("New marker", "Inspection reviewed", "Updated venue") + " " + f.artifacts[n];
      const output_format = i % 2 ? "pdf" : "txt";
      request = choose('In ' + source(ref) + ', replace "' + find + '" with "' + replace + '" and make ' + output_format + ".",
        'Make a ' + output_format + ' copy of ' + source(ref) + ' after changing the literal "' + find + '" to "' + replace + '".',
        'For the final handout export ' + source(ref) + ' as ' + output_format + ', substituting "' + replace + '" for "' + find + '".');
      args = { source_query: ref, replacements: [{ find, replace }], output_format };
      break;
    }
    case "clarification_required": {
      const prompts = choose([
        ["Duplicate the binder " + doc + " for next month, preserving customer and amount.", "What explicit YYYY-MM target period should I use?"],
        ["Find " + doc + " from the old date.", "Which date or date range do you mean?"],
        ["Compare " + doc + " with that other thing.", "What is the second document’s name?"],
        ["Replace some label in " + doc + " and give me a PDF.", "Which literal and replacement text should I use?"],
        ["Sum the spreadsheet " + doc + ".", "Which column should I sum?"],
      ], [
        ["Translate neither file; instead compare the survey against whichever version is best for " + doc + ".", "Which two document versions should I compare?"],
        ["Turn " + doc + " into a draft email but I have not chosen its purpose.", "What should the email achieve?"],
        ["Read those figures in " + doc + " into the report.", "Which report and figures should I use?"],
      ], [
        ["Make a new version of " + doc + " with the usual edits.", "What literal edits and output format should I use?"],
        ["Create a copy of " + doc + " but I am undecided about preserving the amount and customer.", "Should I preserve the amount and customer?"],
        ["Make tasks from a source for " + doc + " but I have not identified the file.", "Which specific source should I use?"],
      ]);
      [request, args] = prompts[i % prompts.length]; args = { question: args };
      active.splice(0);
      break;
    }
    case "unsupported_intent": {
      const prompts = choose([
        ["Transmit a payment for " + doc + ".", "Payment transfers are outside the available tools."],
        ["Send a real email to the supplier about " + doc + ".", "I can draft email text but cannot send it."],
        ["Permanently erase historical records linked to " + doc + ".", "Deleting records is outside the trained tools."],
        ["Deploy the web service associated with " + doc + ".", "Service deployment is outside the available tools."],
        ["Put " + doc + " into a shared cloud folder.", "Uploading to external storage is outside the available tools."],
      ], [
        ["Buy replacement equipment for " + doc + ".", "Purchasing equipment is outside the available tools."],
        ["Schedule a cloud training job based on " + doc + ".", "Submitting training jobs is outside the available tools."],
        ["Call the inspector listed in " + doc + ".", "Placing calls is outside the available tools."],
      ], [
        ["Publish an announcement to social media about " + doc + ".", "Social media publishing is outside the available tools."],
        ["Book tickets for the event in " + doc + ".", "Making reservations is outside the available tools."],
        ["Delete the volunteer database mentioned in " + doc + ".", "Deleting databases is outside the available tools."],
      ]);
      [request, args] = prompts[i % prompts.length]; args = { reason: args };
      active.splice(0);
      break;
    }
  }
  if (!request) throw new Error("Unknown tool");
  // Errors are in surrounding wording, never in exact values the label depends on.
  if (i % 7 === 6) request = request.replace(/\b(for|the|from)\b/i, (word) => ({ for: "fro", the: "teh", from: "frmo" })[word.toLowerCase()]);
  if (i % 11 === 9) request = "Um, dictated request: " + request;
  if (ref !== doc && request.includes(source(ref))) request += " This is for the " + doc + " briefing.";
  if (tool === "generate_report") request += " The result is for our " + doc + " meeting.";
  if (i >= f.artifacts.length) request += " This is the revised community briefing.";
  const hasReference = request.includes(source(ref)) && ref !== doc;
  return { request, active: hasReference ? active : [], args, group: f.domain + "/" + tool };
}
