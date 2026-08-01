const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, '..', 'config');

function loadConfigs() {
  const files = fs.readdirSync(CONFIG_DIR).filter((f) => f.endsWith('.json'));
  const configs = new Map();
  for (const file of files) {
    const raw = fs.readFileSync(path.join(CONFIG_DIR, file), 'utf-8');
    const config = JSON.parse(raw);
    configs.set(config.id, config);
  }
  return configs;
}

let cache = loadConfigs();

function listObjects() {
  return Array.from(cache.values()).map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    fieldCount: c.fields.length,
    keyFields: c.keyFields,
  }));
}

function getObject(id) {
  return cache.get(id);
}

function reload() {
  cache = loadConfigs();
}

module.exports = { listObjects, getObject, reload };
