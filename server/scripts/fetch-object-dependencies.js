/**
 * Builds the migration-object dependency graph from the SAP Help Portal.
 *
 * Each migration object's documentation carries a "Prerequisites" section listing
 * the objects that must already be maintained or migrated. Those entries are
 * hyperlinked to the prerequisite object's own page, so edges are resolved by
 * page id rather than by fuzzy name matching.
 *
 * Re-run this to refresh src/objectDependencies.json when SAP updates the docs.
 */
const fs = require('fs');
const path = require('path');

const DELIVERABLE_ID = '39118094';
const BUILD_NO = '3408';
const INDEX_PAGE = '8dd142b479f9481891fa8b3f86648df3.html';
const PAGE = (file) =>
  `https://help.sap.com/http.svc/pagecontent?deliverableInfo=1&deliverable_id=${DELIVERABLE_ID}&buildNo=${BUILD_NO}&file_path=${file}`;

const PAGE_ID = /^[0-9a-f]{32}\.html$/;

async function fetchBody(file) {
  const res = await fetch(PAGE(file));
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${file}`);
  const json = await res.json();
  return json.data.body;
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

/** Index page: every migration object row links to its own documentation page. */
function parseIndex(html) {
  const rows = html.split(/<tr[^>]*>/i).slice(1);
  const objects = [];

  for (const row of rows) {
    const cells = row.split(/<td[^>]*>/i).slice(1);
    if (cells.length < 3) continue;
    if (!/Staging Table/i.test(stripTags(cells[2]))) continue;

    const link = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(cells[0]);
    if (!link) continue;

    const href = link[1].split('#')[0];
    if (!PAGE_ID.test(href)) continue;

    objects.push({ name: stripTags(link[2]), href });
  }

  return objects;
}

/** Object page: pull the linked objects out of the Prerequisites section only. */
function parsePrerequisites(html) {
  const heading = /<h[123][^>]*>\s*Prerequisites\s*<\/h[123]>/i.exec(html);
  if (!heading) return [];

  const after = html.slice(heading.index + heading[0].length);
  // Stop at the next section heading so later sections don't leak in.
  const nextHeading = /<h[123][^>]*>/i.exec(after);
  const section = nextHeading ? after.slice(0, nextHeading.index) : after;

  const prereqs = [];
  const seen = new Set();
  const linkPattern = /<li[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match;
  while ((match = linkPattern.exec(section)) !== null) {
    const href = match[1].split('#')[0];
    if (!PAGE_ID.test(href) || seen.has(href)) continue;
    seen.add(href);
    prereqs.push({ name: stripTags(match[2]), href });
  }

  return prereqs;
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function main() {
  process.stdout.write('Fetching migration object index… ');
  const objects = parseIndex(await fetchBody(INDEX_PAGE));
  console.log(`${objects.length} Staging Table objects`);

  let done = 0;
  const scraped = await mapWithConcurrency(objects, 8, async (obj) => {
    const prereqs = parsePrerequisites(await fetchBody(obj.href));
    done += 1;
    if (done % 25 === 0) console.log(`  …${done}/${objects.length}`);
    return { ...obj, prereqs };
  });

  const nameByHref = new Map(scraped.map((o) => [o.href, o.name]));

  const dependsOn = {};
  const requiredBy = {};
  let edges = 0;
  const unresolved = [];

  for (const obj of scraped) {
    dependsOn[obj.name] = [];
    for (const prereq of obj.prereqs) {
      const resolved = nameByHref.get(prereq.href);
      if (!resolved) {
        unresolved.push({ object: obj.name, prerequisite: prereq.name });
        continue;
      }
      if (resolved === obj.name) continue;
      if (dependsOn[obj.name].includes(resolved)) continue;
      dependsOn[obj.name].push(resolved);
      (requiredBy[resolved] = requiredBy[resolved] || []).push(obj.name);
      edges += 1;
    }
    dependsOn[obj.name].sort();
  }

  for (const key of Object.keys(requiredBy)) requiredBy[key].sort();

  const output = {
    source: 'https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/d3a3eb7caa1842858bf0372e17ad3909/8dd142b479f9481891fa8b3f86648df3.html',
    migrationApproach: 'Staging Table',
    retrieved: new Date().toISOString().slice(0, 10),
    objectCount: scraped.length,
    edgeCount: edges,
    dependsOn,
    requiredBy,
  };

  const target = path.join(__dirname, '..', 'src', 'objectDependencies.json');
  fs.writeFileSync(target, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`\nObjects: ${scraped.length}  Edges: ${edges}  Unresolved: ${unresolved.length}`);
  if (unresolved.length) console.log('Unresolved:', unresolved.slice(0, 10));
  console.log(`Wrote ${path.relative(process.cwd(), target)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
