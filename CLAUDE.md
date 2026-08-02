# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An "AI Migration Cockpit Agent": a validator for SAP S/4HANA Migration Cockpit templates
(Staging Table approach). A user uploads a filled-in migration template (XML Spreadsheet
2003, or `.xlsx` as a flagged working copy) and gets back a cockpit-style validation report
— structural integrity, mandatory-field coverage, referential integrity, type/length
conformance, value-mapping readiness, and failure-cascade impact — without needing a live
SAP connection.

Two independent npm projects, no root `package.json`:

- `client/` — React 19 + Vite 8 SPA (upload UI, report rendering).
- `server/` — Node/Express API (parsing + validation logic). CommonJS (`require`), not ESM.

## Commands

Run from inside `client/` or `server/` respectively (no workspace root scripts).

```bash
# server
npm --prefix server run dev     # node --watch src/index.js — API on :4000
npm --prefix server start       # node src/index.js, no watch

# client
npm --prefix client run dev     # vite dev server on :5173, proxies /api -> localhost:4000
npm --prefix client run build
npm --prefix client run lint    # oxlint
npm --prefix client run preview
```

There is no test runner configured in either `package.json`. `.claude/launch.json` defines a
`client` launch config that runs the Vite dev server on port 5173.

Utility scripts (`server/scripts/`, run with plain `node`, not npm scripts):

- `fetch-object-dependencies.js` — re-scrapes the SAP Help Portal to rebuild
  `server/src/objectDependencies.json` (see header comment for the deliverable-id/buildNo
  constants to update if SAP changes them).
- `xlsx-to-xml2003.js <file.xlsx>` — converts an `.xlsx` template to XML Spreadsheet 2003, for
  exercising the SpreadsheetML parser path without Excel installed.

## Architecture

### Request flow

`client` (React, `src/api/client.js`) → `POST /api/validate` (multipart, field `file`) →
`server/src/index.js` → `templateParser.parseTemplate()` → `cockpitValidator.validateTemplate()`
→ JSON report → `ValidationReport`/`ImpactDiagram` components render it.

### `server/src/templateParser.js` — turns a workbook into a structured template

Parses either format into the same shape (`{ format, fileName, sheetNames, fieldList,
dataSheets, mainSheet }`):

- `.xml` (XML Spreadsheet 2003 / SpreadsheetML) via `fast-xml-parser`, with a hand-rolled
  `worksheetFromSpreadsheetML` that resolves `ss:Index` jumps and `ss:MergeAcross` manually,
  since SpreadsheetML stores rows/cells sparsely.
- `.xlsx` via `exceljs` (accepted but always flagged downstream as non-conformant — the
  cockpit only accepts XML Spreadsheet 2003).

Template layout it depends on (reverse-engineered from a real cockpit-generated template —
see `docs/REFERENCES.md` §3 for the full derivation):

- Sheet order: `Introduction`, `Field List`, then one sheet per SAP structure. Only the first
  data sheet after `Field List` is mandatory; it is treated as the **main/key table**
  (`template.mainSheet`).
- **`Field List` sheet** (header on row 4) is the authority the parser diffs everything else
  against: which sheets should exist, in what order, which columns each should have, and
  which are mandatory. A "banner row" (sheet name repeated across every column) marks the
  start of each sheet's field block.
- **Data sheets** carry SAP metadata in *hidden* rows that must stay hidden and intact:
  row 4 = SAP technical structure (e.g. `S_MARA`), row 5 = technical field names, row 6 =
  type spec (`kind;length;decimals;category;outputLength;outputDecimals`, e.g.
  `ETE;80;0;C;80;0`). Row 8 is the visible header, whose first line is the field name with a
  trailing `*` marking it mandatory. Data starts at row 9.

### `server/src/cockpitValidator.js` — the validation pipeline

`validateTemplate()` runs numbered layers in order into a `Report` (grouped by section,
severities Error/Warning/Information/Success), short-circuiting the data-dependent layers if
structure is broken (the real cockpit would reject the file before reaching them):

0. Prerequisites — file format (must be XML Spreadsheet 2003), size (100 MB cockpit limit,
   160 MB hard multer limit), "precision as displayed" (flagged as unverifiable, not checked).
1. Structure — sheet/column roster, order, and hidden technical rows must match the Field
   List exactly; any drift (added/removed/reordered sheet or column, unhidden technical row,
   formulas in data cells) is a structure-corruption error.
2. Mandatory coverage — every "active" row (has data in *any* field) must have all its
   mandatory fields populated.
2b. Referential integrity — main-sheet key uniqueness, and every child-sheet foreign key must
    resolve to a main-sheet record.
3. Type/length conformance — Text/Number/Date/Time per the row-6 type spec (dates accept
   US/DE/ISO formats; numbers cap at 3 decimals and 15 significant digits, matching Excel's
   float precision).
4. Value mapping readiness — flags Text/80 columns (the convention for cockpit
   value-mapping-eligible fields) and surfaces likely-duplicate source variants (same
   normalized token, different spelling) as a warning.
5. Check tables — always reported as "not performed": validating against SAP config tables
   (T001, T001W, T005, TCURC, ...) needs a live SAP connection this tool doesn't have.

Beyond the numbered layers:

- **Migration object lookup** (`checkMigrationObject`) matches the Field List's declared
  object name against `stagingObjectCatalog.js` (228 Staging-Table objects scraped from SAP
  Help) and flags `(deprecated)`/`(restricted)` objects.
- **Failure cascade / impact graph** (`buildImpactGraph`) — the cockpit loads the header
  record before its children, so a failed main-sheet row blocks every child row pointing at
  it even if that child row is itself clean. Produces the graph the client's
  `ImpactDiagram` renders.
- **Downstream object impact** (`buildDownstreamImpact`) — inverts
  `server/src/objectDependencies.json` (prerequisite edges scraped per-object from SAP Help)
  to do a BFS over `requiredBy`, reporting which *other* migration objects are transitively
  blocked if this one has errors.

When touching validation logic, keep messages self-contained and actionable (they're shown
directly in the report) and prefer reporting "not performed" over fabricating a result — see
`docs/REFERENCES.md` §6 for the two documented gaps (check tables, cross-object business
rules) and why they're stubs rather than guesses.

### Data provenance

`docs/REFERENCES.md` is the source-of-truth log for where every scraped fact, dependency
choice, and template-structure assumption came from, plus known gaps/caveats and version
mismatches (dependency graph vs. sample template SAP release). Consult it — and update it —
whenever you change catalogue/dependency data or discover another cockpit constraint that
isn't derivable from code.

### Security-relevant dependency choices

`xlsx` (SheetJS) is deliberately not used — replaced with `exceljs` due to an unpatched
prototype-pollution/ReDoS advisory. `multer` is pinned to 2.x for the same reason. Don't
reintroduce `xlsx` or downgrade `multer` without re-checking current advisories.
