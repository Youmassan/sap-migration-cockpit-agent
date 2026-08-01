# References & Provenance

Where every fact, rule, and dependency in this project came from — so anything can be
re-checked or refreshed rather than trusted on faith.

Last updated: 2026-08-01

---

## 1. Specification

| Item | Location |
|---|---|
| Agent specification & system prompt | `C:\Program Files\Notepad++\sap data ai migration validator.md` (supplied by the user) |
| Real template used for development | `C:\Users\hp\Downloads\Source data for Product.xlsx` |

The spec defines the agent persona, the prerequisite checks, and validation Layers 1–6
plus the cockpit-style report format. The implementation follows it with two documented
departures — see [§6 Gaps](#6-known-gaps--caveats).

---

## 2. SAP Help Portal

### 2.1 Available Migration Objects (primary source)

<https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/d3a3eb7caa1842858bf0372e17ad3909/8dd142b479f9481891fa8b3f86648df3.html>

Used for two things:

1. **The object catalogue** — filtered to `Migration Approach = Staging Table`, giving
   **228 objects** (177 master data, 51 transactional). Stored in
   `server/src/stagingObjectCatalog.js`.
2. **The dependency graph** — each object's page carries a *Prerequisites* section reading
   "The following objects have already been maintained or migrated:", with entries
   hyperlinked to the prerequisite object's own page. Stored in
   `server/src/objectDependencies.json`.

The page is a client-side-rendered SPA, so a plain HTTP fetch returns only the shell. The
table is delivered by an internal JSON endpoint:

```
https://help.sap.com/http.svc/pagecontent?deliverableInfo=1&deliverable_id=39118094&buildNo=3408&file_path=<PAGE_ID>.html
```

The document body arrives as HTML under `data.body`. Pagination is client-side, so this one
request returns all 487 rows (228 of them Staging Table).

**Edges are resolved by page ID, not by object name.** Prerequisite entries are `<a>` links
carrying the target page's 32-hex id, which removes any fuzzy name-matching risk — e.g. the
Product page lists `Supplier` (Manufacturer), where the role qualifier sits outside the link.

Result: **228 objects, 632 edges, 0 unresolved.** Every prerequisite resolves to another
object inside the Staging Table set, which is a strong signal the parse is correct.

### 2.2 Object page used for structure discovery

| Object | Page ID |
|---|---|
| Product | `289644d401a844878ce84670517dfa98.html` |

Product's documented prerequisites: `CO - Profit center`, `PP-KAB - Production supply area`,
`Supplier`.

### 2.3 Documented constraints applied in the validator

Taken from the same source and surfaced in the report:

- Migration objects perform **initial load only** — they create records, they cannot change
  or update records that already exist in the target system.
- **`(restricted)`** in an object name — not all fields and structures of the related
  business processes are covered.
- **`(deprecated)`** — a newer version exists; deprecated objects are removed after a few
  releases (SAP Note 2698032).
- Custom objects can be built or extended with the migration object modeler, transaction
  **LTMOM** (SAP Note 2481235).

### 2.4 SAP Help aliases

| Alias | Target |
|---|---|
| <http://help.sap.com/S4_OP_MO> | Available Migration Objects (§2.1) |
| <http://help.sap.com/S4_OP_DM> | Data migration landing page |
| <http://help.sap.com/S4_OP_DM_STATUS> | Data migration entry topic |

### 2.5 Refreshing the graph

```bash
node server/scripts/fetch-object-dependencies.js
```

Re-fetches the index and all 228 object pages and rewrites
`server/src/objectDependencies.json`. If SAP changes `deliverable_id` or `buildNo`, update
the constants at the top of that script.

---

## 3. Template structure (reverse-engineered from the real file)

Not documented anywhere consulted — derived by inspecting
`Source data for Product.xlsx` and encoded in `server/src/templateParser.js`.

### Workbook layout

- 29 sheets: `Introduction`, `Field List`, then 27 data sheets.
- The **first sheet after `Field List`** is the main/key table — here `Basic Data`.
- Only `Basic Data` is a mandatory sheet; the `(mandatory)` suffix appears in the Field List
  roster, **not** in the actual sheet name.

### `Field List` sheet — header on row 4

| Column | Content |
|---|---|
| B | Sheet Name (with `(mandatory)` suffix where applicable) |
| C | Group Name |
| D | Field Description |
| E | Importance — `mandatory for sheet` marks a mandatory field |
| F | Type — `Text` / `Number` / `Date` / `Time` |
| G | Length |
| H | Decimal |
| I | SAP Structure |
| J | SAP Field |

A sheet banner row repeats the sheet label across every column (merged cells); that is how
the parser detects the start of each sheet's field block.

### Data sheets — the hidden "DNA"

| Row | Hidden | Content |
|---|---|---|
| 1–2 | no | Title and version banner |
| **4** | **yes** | SAP technical structure, e.g. `S_MARA` (column A only) |
| **5** | **yes** | SAP technical field names, e.g. `PRODUCT`, `MTART` |
| **6** | **yes** | Type/length spec, e.g. `ETE;80;0;C;80;0` |
| 7 | no | Group name |
| 8 | no | Display header + embedded description; a trailing `*` marks mandatory |
| **9** | no | **First data row** |

Row 6 spec format is `kind;length;decimals;category;outputLength;outputDecimals`. Observed
kinds: `ETE` (text), `ENU` (number), `EDA` (date).

### Product template facts

- Main sheet `Basic Data` → structure `S_MARA`, key `Product Number` → `PRODUCT`
- 136 fields, 5 mandatory: Product Number, Product Type, Description, Language Key,
  Base Unit of Measure (ISO Format)
- Sample data: 3 records across `Basic Data`, `Storage Locations`, `Warehouse Number Data`
- Field List and row-8 headers agree exactly on both field set and mandatory markers

---

## 4. Dependency findings

Product is the **most depended-on object in the entire Staging Table catalogue**.

| Object | Direct dependents |
|---|---|
| Product | 73 |
| Supplier | 32 |
| Customer | 26 |
| CO - Profit center | 24 |
| CO - Cost center | 24 |
| Characteristic | 18 |

Product's full blast radius: **73 direct, 115 transitive, 4 levels deep.**

---

## 5. Tooling installed

| Tool | Version | Source |
|---|---|---|
| Node.js | v24.18.1 LTS | <https://nodejs.org/dist/v24.18.1/node-v24.18.1-x64.msi> (verified against <https://nodejs.org/dist/index.json>) |
| npm | 11.16.0 | bundled with Node |
| `frontend-design` skill | — | <https://github.com/anthropics/skills/tree/main/skills/frontend-design> → `~/.claude/skills/frontend-design` |
| `ui-ux-pro-max-cli` | 2.12.0 | <https://www.npmjs.com/package/ui-ux-pro-max-cli> (repo: <https://github.com/nextlevelbuilder/ui-ux-pro-max-skill>) — binary `uipro` |

### Runtime dependencies

**Server:** `express` 4.21, `cors` 2.8, `multer` **2.x**, `exceljs` 4.4, `fast-xml-parser` 5.10
**Client:** React + Vite

Two dependency swaps were made for security:

- **`xlsx` → `exceljs`** — SheetJS carries an unpatched high-severity prototype-pollution
  and ReDoS advisory ([GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6),
  [GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9)) with no fix available.
- **`multer` 1.x → 2.x** — 1.x is affected by known vulnerabilities patched in 2.x.

One accepted residual: `exceljs` depends on `uuid` <11.1.1, a *moderate* advisory
([GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)) that only triggers
when a caller passes a custom buffer to v3/v5/v6 — which exceljs does not do.

### Diligence on `ui-ux-pro-max-cli`

Installed only after checking, because the repo's ~112k GitHub stars on an 8-month-old
project matches a known star-inflation pattern:

| Check | Finding |
|---|---|
| Install hooks | **None** — no `preinstall`/`postinstall`/`install`. `prepublishOnly` runs only for the maintainer. |
| Downloads | 103,027 in Jul 2026 (<https://api.npmjs.org/downloads/point/last-month/ui-ux-pro-max-cli>) |
| Dependencies | `chalk`, `commander`, `ora`, `prompts` — all mainstream |
| Registry metadata | <https://registry.npmjs.org/ui-ux-pro-max-cli> |

Absence of lifecycle hooks is the decisive fact: the global install copies files and runs no
code. The star count still looks inflated, so treat its design guidance as opinion rather
than authority.

---

## 6. Known gaps & caveats

1. **Layer 5 (check tables) is not implemented.** Validating Company Code against `T001`,
   Plant against `T001W`, Country against `T005`, Currency against `TCURC` etc. requires a
   live SAP connection. The report says so explicitly rather than inventing configuration
   data. Extension point: `checkConfigTables()` in `server/src/cockpitValidator.js`.

2. **Layer 6 cross-object business rules are not implemented** for the same reason.

3. **Version mismatch.** The dependency graph and object catalogue come from the
   **S/4HANA 2023** documentation, while the sample template reports
   **SAP S/4HANA 2025**. The 2023 page notes the object documentation moved as of 2025.
   Product's entry is unchanged, but other objects may have drifted. Re-run the scraper
   against a 2025 deliverable id when one is available.

4. **"Set precision as displayed" cannot be verified.** It is an Excel application setting
   that leaves no trace in the saved file. The report flags it as unverifiable rather than
   silently passing it.

5. **`.xlsx` is accepted but flagged.** The cockpit only takes XML Spreadsheet 2003 (`.xml`).
   `.xlsx` is parsed so problems can be caught early, but reported as a blocking prerequisite
   error. `server/scripts/xlsx-to-xml2003.js` converts between them.

---

## 7. Decisions taken during the build

Recorded because they shape the implementation and were chosen, not derived:

| Decision | Choice |
|---|---|
| Stack | React + Vite frontend, Node/Express backend |
| Validation depth | Full business validation |
| Object configuration | Template-driven — the Field List **is** the config; no per-object files |
| Migration approach | Staging Table only |
| File formats | Parse both `.xml` and `.xlsx`; flag non-XML as a prerequisite error |
| Check tables | Report as not performed rather than fabricate config data |
| Failure cascade | Both intra-template (rows) and cross-object (migration objects) |
| Git identity | `Youmassan` / `Youmassan@users.noreply.github.com` |

---

## 8. Commit history

| Commit | Description |
|---|---|
| `12ee9a9` | Initial cockpit app (per-object JSON configs — superseded) |
| `a30955b` | Rebuild as template-driven agent reading the Field List |
| `9eb6487` | Failure impact cascades + scraped dependency graph |
