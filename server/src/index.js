const express = require('express');
const cors = require('cors');
const multer = require('multer');

const configStore = require('./configStore');
const { parseFile } = require('./fileParser');
const { validate } = require('./validationEngine');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/objects', (req, res) => {
  res.json(configStore.listObjects());
});

app.get('/api/objects/:id', (req, res) => {
  const config = configStore.getObject(req.params.id);
  if (!config) return res.status(404).json({ error: `Object '${req.params.id}' not found` });
  res.json(config);
});

app.post('/api/objects/:id/validate', upload.single('file'), async (req, res) => {
  const config = configStore.getObject(req.params.id);
  if (!config) return res.status(404).json({ error: `Object '${req.params.id}' not found` });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded. Attach a file under field name "file".' });

  let parsed;
  try {
    parsed = await parseFile(req.file.buffer, req.file.originalname);
  } catch (err) {
    return res.status(400).json({ error: `Could not parse uploaded file: ${err.message}` });
  }

  if (parsed.headers.length === 0) {
    return res.status(400).json({ error: 'Uploaded file has no header row / is empty.' });
  }

  const report = validate(config, parsed.headers, parsed.rows);
  res.json({
    objectId: config.id,
    objectName: config.name,
    fileName: req.file.originalname,
    ...report,
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`SAP Data Migration Cockpit API listening on http://localhost:${PORT}`);
});
