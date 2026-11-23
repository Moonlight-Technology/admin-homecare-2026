# Region data notice

`regions.tsv.gz` holds Indonesian administrative regions (38 provinces, 514 regencies/cities, 7,285 districts,
83,762 villages/kelurahan; 91,599 rows) as `code<TAB>name`, parents before children.

- Source: [cahyadsn/wilayah](https://github.com/cahyadsn/wilayah), `db/wilayah.sql` (file header: Kepmendagri
  No 300.2.2-2138 Tahun 2025, last edit 2026-02-13), downloaded 2026-11-23. Counts match the Kepmendagri
  No 300.2.2-2430 Tahun 2025 totals listed in that repository.
- Changes: parsed from SQL to tab-separated text, whitespace in names collapsed, sorted by level then code. Codes and
  names are otherwise unchanged.
- To refresh: download the new `db/wilayah.sql`, convert it the same way, and re-run `prisma:seed`; the seed only adds
  missing codes and never renames or deletes existing ones.

The data is used under the following license:

```
MIT License

Copyright (c) 2017-2025 Cahya DSN

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
