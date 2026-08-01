const express = require('express');
const cors = require('cors');
const multer = require('multer');

const { parseTemplate } = require('./templateParser');
const { validateTemplate } = require('./cockpitValidator');
const catalog = require('./stagingObjectCatalog');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 160 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/staging-objects', (req, res) => {
  res.json({ count: catalog.count, objects: catalog.OBJECTS });
});

app.post('/api/validate', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Attach the migration template under field name "file".' });
  }

  const name = req.file.originalname || '';
  if (!/\.(xml|xlsx|xls)$/i.test(name)) {
    return res.status(400).json({ error: 'Unsupported file type. Upload an XML Spreadsheet 2003 (.xml) migration template, or an .xlsx working copy.' });
  }

  let template;
  try {
    template = await parseTemplate(req.file.buffer, name);
  } catch (err) {
    return res.status(400).json({ error: `Could not read the template: ${err.message}` });
  }

  if (!template.fieldList) {
    return res.status(422).json({
      error: "This file has no readable 'Field List' sheet, so it is not a recognisable SAP Migration Cockpit template. Download a fresh template from the cockpit and re-enter your data.",
    });
  }

  res.json(validateTemplate(template, req.file.size));
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`AI Migration Cockpit Agent API listening on http://localhost:${PORT}`);
});
