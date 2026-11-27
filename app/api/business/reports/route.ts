import { authenticated, failure, privateHeaders } from "@/lib/document-api";
import { WorkspaceError } from "@/lib/database";
import { exportFormat, exportReport, reportId, taskStatus } from "@/lib/business-export";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await authenticated();
    const query = new URL(request.url).searchParams;
    const report = reportId.safeParse(query.get("report"));
    const format = exportFormat.safeParse(query.get("format"));
    const status = taskStatus.optional().safeParse(query.get("status") ?? undefined);
    if (!report.success || !format.success || !status.success || status.data && report.data !== "tasks") {
      throw new WorkspaceError("Choose an allowlisted report and output format.");
    }
    const { name, bytes, type, truncated } = await exportReport(report.data, format.data, status.data);
    return new Response(new Uint8Array(bytes), { headers: { ...privateHeaders, "Content-Type": type,
      "Content-Disposition": 'attachment; filename="' + name + '"', "X-Export-Truncated": String(truncated) } });
  } catch (error) { return failure(error); }
}
