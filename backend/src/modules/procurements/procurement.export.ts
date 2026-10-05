import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { resolve } from "node:path";
export type ReportRow = (string | number)[];
export function procurementReportRows(data: any): ReportRow[] {
  if (data.kind === "receipts") return data.rows as ReportRow[];
  const rows: ReportRow[] = [
    ["Ta’minot va Kirimlar Tahlili"],
    ["Davr", data.from, data.to],
    ["Yetkazib beruvchi", data.supplier ?? "Barchasi"],
    ["Ko‘rsatkich", "Qiymat"],
    ["Jami kirim xarajati", data.totalProcurementSpend],
    ["Partiyalar", data.totalBatchesCount],
    ["O‘rtacha partiya", data.averageBatchValue],
    ["Qabul qilingan dona", data.totalItemsProcured.dona],
    ["Qabul qilingan kg", data.totalItemsProcured.kg],
    ["Savdo tushumi", data.totalRevenue],
    ["Sotilgan tovar tannarxi", data.costOfGoodsSold],
    ["Yalpi foyda", data.grossProfit],
    ["Savdo − Kirim balansi", data.cashFlowBalance],
    ["Joriy qoldiq tannarxi", data.inventoryValue],
    ["Qoldiq baholash vaqti", data.generatedAt],
    [
      "Izoh",
      "Savdo tushumi hisoblangan daromad; qarzdorlik to‘lovlari emas. Qoldiq joriy xarid narxida baholanadi. " +
        (data.supplier
          ? "Yetkazib beruvchi filtri faqat kirimlarga tegishli; savdo va qoldiq butun do‘kon bo‘yicha."
          : "") +
        "",
    ],
    [],
    ["Xarajat dinamikasi"],
    ["Sana", "Kirim xarajati", "Partiyalar", "Savdo tushumi", "Yalpi foyda"],
  ];
  for (const r of data.costTrends)
    rows.push([r.date, r.spend, r.batches, r.revenue, r.grossProfit]);
  rows.push(
    [],
    ["Eng ko‘p mablag‘ sarflangan mahsulotlar"],
    [
      "Mahsulot",
      "Birlik",
      "Miqdor",
      "Xarajat",
      "O‘rtacha narx",
      "Davr boshidagi narx",
      "So‘nggi narx",
      "O‘zgarish %",
    ],
  );
  for (const p of data.topCostProducts)
    rows.push([
      p.name,
      p.unit,
      p.quantity,
      p.totalCost,
      p.averageBuyPrice,
      p.previousBuyPrice ?? p.firstBuyPrice,
      p.latestBuyPrice,
      p.priceChangePercent ?? "—",
    ]);
  return rows;
}
export function procurementCsv(data: any) {
  const cell = (v: string | number) => {
    let s = String(v);
    if (typeof v === "string" && /^[\s]*[=+\-@]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return (
    "\uFEFF" + (data.kind === "receipts" ? "sep=,\r\n" : "") +
    procurementReportRows(data)
      .map((row) => row.map(cell).join(","))
      .join("\r\n")
  );
}
export async function procurementExport(
  data: any,
  format: "csv" | "xlsx" | "pdf",
) {
  const rows = procurementReportRows(data);
  if (format === "csv")
    return {
      mime: "text/csv; charset=utf-8",
      body: Buffer.from(procurementCsv(data), "utf8"),
    };
  if (format === "xlsx") {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Kirimlar");
    sheet.columns = Array.from({ length: Math.max(...rows.map(row => row.length)) }, (_, i) => ({ width: i === 0 ? 45 : 24 }));
    sheet.addRows(rows);
    sheet.getRow(1).font = { bold: true, size: 16 };
    sheet.views = [{ state: "frozen", ySplit: 4 }];
    if (data.kind === "receipts") {
      sheet.columns.forEach((column, i) => { column.width = [7, 15, 26, 30, 17, 11, 20, 22, 30][i] ?? 24; });
      sheet.mergeCells("A1:I1");
      sheet.getRow(1).height = 30;
      sheet.getRow(4).height = 27;
      sheet.getRow(4).eachCell(cell => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6D28D9" } };
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      });
      sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(4, rows.length - 1), column: 9 } };
      sheet.eachRow((row, i) => {
        if (i <= 4) return;
        row.height = 25;
        row.alignment = { vertical: "middle", wrapText: true };
        row.getCell(5).numFmt = "#,##0.###";
        for (const column of [7, 8]) row.getCell(column).numFmt = "#,##0.##";
        if (i === rows.length) { row.font = { bold: true }; row.eachCell(cell => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDE9FE" } }; }); }
      });
    }
    return {
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body: Buffer.from(await book.xlsx.writeBuffer()),
    };
  }
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: 36,
    bufferPages: true,
  });
  const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolveBody, reject) => {
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolveBody(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  doc.registerFont(
    "regular",
    resolve(__dirname, "../../../assets/Inter-Regular.ttf"),
  );
  doc.registerFont(
    "semibold",
    resolve(__dirname, "../../../assets/Inter-SemiBold.ttf"),
  );
  const left = 36,
    width = doc.page.width - 72;
  const money = (n: number) =>
    n.toLocaleString("uz-UZ", { maximumFractionDigits: 2 });
  const qty = (n: number) =>
    n.toLocaleString("uz-UZ", { maximumFractionDigits: 3 });
  doc.fillColor("#2563eb").rect(left, 30, width, 4).fill();
  doc
    .font("semibold")
    .fillColor("#111827")
    .fontSize(20)
    .text("HISVEX | Kirimlar tahlili", left, 48);
  doc
    .font("regular")
    .fontSize(10)
    .fillColor("#4b5563")
    .text(
      `${data.from} - ${data.to} | Yetkazib beruvchi: ${data.supplier ?? "Barchasi"}`,
      left,
      78,
      { width },
    );
  doc.text("Valyuta: so'm | Qoldiq baholash vaqti: " + data.generatedAt, {
    width,
  });
  let y = doc.y + 18;
  const section = (title: string) => {
    if (y > doc.page.height - 110) {
      doc.addPage();
      y = 36;
    }
    doc.font("semibold").fontSize(12).fillColor("#111827").text(title, left, y);
    y = doc.y + 12;
  };
  function table(
    headers: string[],
    values: (string | number)[][],
    weights: number[],
  ) {
    const total = weights.reduce((a, b) => a + b, 0),
      widths = weights.map((w) => (w / total) * width);
    const row = (
      cells: (string | number)[],
      header: boolean,
      index: number,
    ) => {
      doc.font(header ? "semibold" : "regular").fontSize(8);
      const height =
        Math.max(
          ...cells.map((v, i) =>
            doc.heightOfString(String(v), { width: widths[i] - 16 }),
          ),
        ) + 10;
      if (y + height > doc.page.height - 42) {
        doc.addPage();
        y = 36;
        if (!header) row(headers, true, 0);
      }
      doc
        .fillColor(header ? "#eff6ff" : index % 2 ? "#f9fafb" : "#ffffff")
        .rect(left, y, width, height)
        .fill();
      let x = left;
      cells.forEach((v, i) => {
        doc
          .font(header ? "semibold" : "regular")
          .fontSize(8)
          .fillColor(header ? "#1d4ed8" : "#111827")
          .text(String(v), x + 8, y + 5, { width: widths[i] - 16 });
        x += widths[i];
      });
      y += height;
      doc
        .strokeColor("#e5e7eb")
        .lineWidth(0.4)
        .moveTo(left, y)
        .lineTo(left + width, y)
        .stroke();
    };
    row(headers, true, 0);
    values.forEach((cells, i) => row(cells, false, i));
    y += 12;
  }
  section("Moliyaviy ko'rsatkichlar");
  table(
    ["Ko'rsatkich", "Qiymat", "Ko'rsatkich", "Qiymat"],
    [
      [
        "Jami kirim xarajati",
        money(data.totalProcurementSpend),
        "Partiyalar",
        data.totalBatchesCount,
      ],
      [
        "O'rtacha partiya",
        money(data.averageBatchValue),
        "Qabul qilingan",
        `${qty(data.totalItemsProcured.dona)} dona / ${qty(data.totalItemsProcured.kg)} kg`,
      ],
      [
        "Savdo",
        money(data.totalRevenue),
        "Sotilgan tovar tannarxi",
        money(data.costOfGoodsSold),
      ],
      [
        "Yalpi foyda",
        money(data.grossProfit),
        "Savdo - kirim balansi",
        money(data.cashFlowBalance),
      ],
      [
        "Joriy qoldiq tannarxi",
        money(data.inventoryValue),
        "Baholash usuli",
        "Oxirgi xarid narxi",
      ],
    ],
    [1.4, 1, 1.4, 1.2],
  );
  section("Xarajat dinamikasi");
  table(
    ["Sana", "Kirim xarajati", "Partiyalar", "Savdo", "Yalpi foyda"],
    data.costTrends.map((v: any) => [
      v.date,
      money(v.spend),
      v.batches,
      money(v.revenue),
      money(v.grossProfit),
    ]),
    [1.1, 1.3, 0.6, 1.3, 1.3],
  );
  section("Eng ko'p kapital sarflangan tovarlar");
  table(
    [
      "Mahsulot",
      "Birlik",
      "Miqdor",
      "Xarajat",
      "O'rtacha narx",
      "Avvalgi narx",
      "Oxirgi narx",
      "O'zgarish %",
    ],
    data.topCostProducts.map((p: any) => [
      p.name,
      p.unit,
      qty(p.quantity),
      money(p.totalCost),
      money(p.averageBuyPrice),
      money(p.previousBuyPrice ?? p.firstBuyPrice),
      money(p.latestBuyPrice),
      p.priceChangePercent ?? "-",
    ]),
    [2.4, 0.6, 0.7, 1.15, 1.15, 1.05, 1.05, 0.9],
  );
  if (y > doc.page.height - 80) {
    doc.addPage();
    y = 36;
  }
  doc
    .font("regular")
    .fontSize(8)
    .fillColor("#6b7280")
    .text(
      "Savdo qarzga sotuvlarni ham hisoblaydi; balans kassadagi naqd pul emas. Qoldiq joriy oxirgi xarid narxida. " +
        (data.supplier
          ? "Yetkazib beruvchi filtri faqat kirimlarga tegishli; savdo va qoldiq butun do'kon bo'yicha."
          : ""),
      left,
      y,
      { width },
    );
  const pages = doc.bufferedPageRange();
  for (let i = pages.start; i < pages.start + pages.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    doc
      .font("regular")
      .fontSize(8)
      .fillColor("#6b7280")
      .text(
        `HISVEX | ${data.from} - ${data.to} | ${i + 1} / ${pages.count}`,
        left,
        doc.page.height - 24,
        { width, align: "right", lineBreak: false },
      );
  }
  doc.end();
  return { mime: "application/pdf", body: await complete };
}
