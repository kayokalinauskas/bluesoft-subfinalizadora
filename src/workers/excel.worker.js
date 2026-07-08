import * as XLSX from "xlsx";

self.onmessage = function (e) {
  try {
    const workbook = XLSX.read(new Uint8Array(e.data), {
      type: "array",
      cellDates: false,
      cellNF: false,
      cellHTML: false,
      cellStyles: false,
      dense: true,
    });
    const sheetName = workbook.SheetNames[0];
    const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
    self.postMessage({ ok: true, data: jsonData });
  } catch (err) {
    self.postMessage({ ok: false, error: err.message });
  }
};
