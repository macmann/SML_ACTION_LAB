import ExcelJS from "exceljs";
import JSZip from "jszip";

export function pdfFixture(withText = true) {
  const stream = withText ? "BT /F1 12 Tf 40 80 Td (Fixture QZ-381) Tj ET" : "10 10 50 50 re S";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 256 256] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream",
  ];
  let file = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = file.length;
    file += (index + 1) + " 0 obj\n" + object + "\nendobj\n";
    return offset;
  });
  return Buffer.from(file + "xref\n0 6\n0000000000 65535 f \n" +
    offsets.map((offset) => String(offset).padStart(10, "0") + " 00000 n \n").join("") +
    "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + file.length + "\n%%EOF\n");
}

export async function docxFixture(mutate) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
  zip.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Fixture heading</w:t></w:r></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Order QZ-381</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>');
  if (mutate) mutate(zip);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export async function xlsxFixture() {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Fixtures");
  sheet.addRow(["Identifier", "Amount"]);
  sheet.addRow(["QZ-381", 17]);
  return Buffer.from(await book.xlsx.writeBuffer());
}
