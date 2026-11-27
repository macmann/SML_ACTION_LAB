import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function convertOffice(bytes, temporary, executable = "/usr/bin/libreoffice", sandbox = "/usr/bin/bwrap") {
  try { await Promise.all([access(executable), access(sandbox)]); }
  catch { throw new Error("DOCX-to-PDF conversion requires LibreOffice and bubblewrap."); }
  const job = await mkdtemp(join(temporary, "office-"));
  try {
    await writeFile(join(job, "source.docx"), bytes, { mode: 0o600 });
    await mkdir(join(job, "profile", "user"), { recursive: true, mode: 0o700 });
    await writeFile(join(job, "profile", "user", "registrymodifications.xcu"),
      '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>', { mode: 0o600 });
    // No host home, app data, sockets or network are exposed to the converter.
    await new Promise((resolve, reject) => {
      const process = spawn("/usr/bin/prlimit", ["--fsize=67108864", "--as=1610612736", "--cpu=20", "--", sandbox,
        "--unshare-all", "--unshare-net", "--die-with-parent", "--new-session", "--clearenv",
        "--ro-bind", "/usr", "/usr", "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib64", "/lib64",
        "--symlink", "usr/bin", "/bin", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
        "--dir", "/etc", "--ro-bind-try", "/etc/fonts", "/etc/fonts", "--bind", job, "/job",
        "--setenv", "HOME", "/tmp", "--setenv", "SAL_USE_VCLPLUGIN", "svp", "--setenv", "PATH", "/usr/bin:/bin", "--chdir", "/job",
        executable, "-env:UserInstallation=file:///job/profile", "--headless", "--nologo", "--nodefault",
        "--nolockcheck", "--norestore", "--convert-to", "pdf:writer_pdf_Export", "--outdir", "/job", "/job/source.docx",
      ], { stdio: "ignore" });
      const timer = setTimeout(() => process.kill("SIGKILL"), 25_000);
      process.once("error", () => { clearTimeout(timer); reject(new Error("The isolated Office converter could not start.")); });
      process.once("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(undefined);
        else reject(new Error("The isolated Office converter was unavailable or timed out."));
      });
    });
    const output = join(job, "source.pdf");
    const file = await open(output, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => { throw new Error("The converter did not produce a PDF."); });
    let pdf;
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > 64 * 1024 ** 2) throw new Error("The converter returned an invalid PDF.");
      pdf = await file.readFile();
    } finally { await file.close(); }
    if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("The converter returned an invalid PDF.");
    return pdf;
  } finally { await rm(job, { recursive: true, force: true }); }
}
