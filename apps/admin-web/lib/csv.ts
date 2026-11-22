/** Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, commas/newlines inside quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^﻿/, '');
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  row.push(field);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return rows;
}

export type RegionCsvRow = { code: string; name: string; level: number; parentCode: string | null };

/** Header row required: code, name, level, parent_code (any order, case-insensitive). */
export function parseRegionCsv(text: string): { rows: RegionCsvRow[]; error?: string } {
  const [header, ...body] = parseCsv(text);
  if (!header) return { rows: [], error: 'File kosong.' };
  const columns = header.map((name) => name.trim().toLowerCase());
  const index = (name: string) => columns.indexOf(name);
  const missing = ['code', 'name', 'level'].filter((name) => index(name) === -1);
  if (missing.length) return { rows: [], error: `Kolom wajib tidak ditemukan: ${missing.join(', ')}. Header yang diharapkan: code,name,level,parent_code.` };
  const parent = index('parent_code');
  return {
    rows: body.map((cells) => ({
      code: (cells[index('code')] ?? '').trim(),
      name: (cells[index('name')] ?? '').trim(),
      level: Number((cells[index('level')] ?? '').trim()),
      parentCode: parent === -1 ? null : (cells[parent] ?? '').trim() || null,
    })),
  };
}
