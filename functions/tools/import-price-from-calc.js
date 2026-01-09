/* eslint-disable */
// Usage (PowerShell):
//   cd functions
//   npm install
//   $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\\path\\service-account.json"
//   node tools/import-price-from-calc.js --project gm-base --source ..\\calc.html
// Optional:
//   node tools/import-price-from-calc.js --project gm-base --source ..\\calc.html --clear

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const admin = require('firebase-admin');

function parseArgs_(argv) {
  const out = { project: null, source: null, clear: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') out.project = argv[++i];
    else if (a === '--source') out.source = argv[++i];
    else if (a === '--clear') out.clear = true;
  }
  return out;
}

function extractArrayLiteral_(text, marker) {
  const idx = text.indexOf(marker);
  if (idx < 0) throw new Error(`Marker not found: ${marker}`);

  const start = text.indexOf('[', idx);
  if (start < 0) throw new Error('Start [ not found after marker');

  let depth = 0;
  let inStr = null; // ', ", `
  let esc = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === '\\') {
        esc = true;
        continue;
      }
      if (ch === inStr) {
        inStr = null;
      }
      continue;
    }

    // Not in string/comment
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === '\'' || ch === '`') {
      inStr = ch;
      continue;
    }

    if (ch === '[') depth++;
    if (ch === ']') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  throw new Error('Unterminated array literal');
}

function loadCatalogFromCalcHtml_(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  const arr = extractArrayLiteral_(html, 'const catalogData');

  // Evaluate in a minimal sandbox.
  const vm = require('vm');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`catalogData = ${arr};`, sandbox, { timeout: 1000 });

  if (!Array.isArray(sandbox.catalogData)) throw new Error('catalogData is not an array');
  return sandbox.catalogData;
}

function makeDocId_(category, name) {
  const h = crypto.createHash('sha1').update(`${category}\n${name}`).digest('hex').slice(0, 16);
  return `p_${h}`;
}

function flattenCatalog_(catalogData) {
  const out = [];
  for (let catIdx = 0; catIdx < catalogData.length; catIdx++) {
    const cat = catalogData[catIdx] || {};
    const category = String(cat.category || '').trim();
    if (!category || !Array.isArray(cat.items)) continue;

    for (let itemIdx = 0; itemIdx < cat.items.length; itemIdx++) {
      const it = cat.items[itemIdx] || {};
      const name = String(it.name || '').trim();
      const price1 = Number(it.price1);
      const price2 = Number(it.price2);
      if (!name) continue;
      if (!Number.isFinite(price1) || !Number.isFinite(price2)) continue;

      out.push({
        id: makeDocId_(category, name),
        category,
        name,
        price1,
        price2,
        sortCategory: catIdx,
        sortItem: itemIdx,
        active: true
      });
    }
  }
  return out;
}

async function clearCollection_(colRef) {
  // Deletes in pages to avoid huge batch.
  while (true) {
    const snap = await colRef.limit(300).get();
    if (snap.empty) break;
    const batch = colRef.firestore.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

async function writeItems_(colRef, items) {
  const db = colRef.firestore;
  let written = 0;
  for (let i = 0; i < items.length; i += 450) {
    const chunk = items.slice(i, i + 450);
    const batch = db.batch();
    for (const it of chunk) {
      const ref = colRef.doc(it.id);
      batch.set(ref, {
        category: it.category,
        name: it.name,
        price1: it.price1,
        price2: it.price2,
        sortCategory: it.sortCategory,
        sortItem: it.sortItem,
        active: it.active,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
    await batch.commit();
    written += chunk.length;
    console.log(`[import] wrote ${written}/${items.length}`);
  }
}

async function main() {
  const args = parseArgs_(process.argv);
  const projectId = args.project || process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'gm-base';
  const source = args.source || path.join(__dirname, '..', '..', 'calc.html');

  if (!fs.existsSync(source)) {
    throw new Error(`Source file not found: ${source}`);
  }

  try {
    if (!admin.apps.length) {
      admin.initializeApp({ projectId });
    }
  } catch (e) {
    console.error('[import] firebase-admin init failed:', e);
    throw e;
  }

  const db = admin.firestore();
  const col = db.collection('priceItems');

  console.log('[import] reading catalog from', source);
  const catalogData = loadCatalogFromCalcHtml_(source);
  const items = flattenCatalog_(catalogData);
  console.log(`[import] parsed items: ${items.length}`);

  if (!items.length) {
    throw new Error('No items parsed. Check calc.html catalogData structure.');
  }

  if (args.clear) {
    console.log('[import] clearing existing priceItems ...');
    await clearCollection_(col);
  }

  console.log('[import] writing priceItems ...');
  await writeItems_(col, items);

  console.log('[import] done');
}

main().catch((e) => {
  console.error('\n[import] FAILED:', e?.message || e);
  console.error('\nTips:');
  console.error('- Ensure you set GOOGLE_APPLICATION_CREDENTIALS to a Firebase service account JSON');
  console.error('- Ensure Firestore is enabled for the project');
  console.error('- Ensure you are importing into the correct project (gm-base)');
  process.exit(1);
});
