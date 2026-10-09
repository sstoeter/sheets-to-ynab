/**
 * validate-manifest.js
 * Ensures src/appsscript.json maintains required OAuth2 library dependency and scopes
 * before any push to Google Apps Script.
 */

const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, '..', 'src', 'appsscript.json');

if (!fs.existsSync(manifestPath)) {
  console.error('❌ Error: src/appsscript.json not found!');
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (err) {
  console.error('❌ Error parsing src/appsscript.json:', err.message);
  process.exit(1);
}

const libraries = (manifest.dependencies && manifest.dependencies.libraries) || [];
const oauthLib = libraries.find(lib => lib.userSymbol === 'OAuth2');

if (!oauthLib) {
  console.error('❌ Error: Missing OAuth2 library dependency in src/appsscript.json!');
  console.error('Expected libraryId: 1B7FSrk5Zi6L1rSxxTDgDEUsPzlukDsi4KGuTMorsTQHhGBzBkMun4iDF');
  process.exit(1);
}

if (oauthLib.libraryId !== '1B7FSrk5Zi6L1rSxxTDgDEUsPzlukDsi4KGuTMorsTQHhGBzBkMun4iDF') {
  console.error('❌ Error: Incorrect libraryId for OAuth2 in src/appsscript.json:', oauthLib.libraryId);
  process.exit(1);
}

const whitelist = manifest.urlFetchWhitelist || [];
const requiredUrls = ['https://api.ynab.com/', 'https://app.ynab.com/'];
for (const url of requiredUrls) {
  if (!whitelist.includes(url)) {
    console.error(`❌ Error: Missing '${url}' in urlFetchWhitelist in src/appsscript.json!`);
    process.exit(1);
  }
}

console.log('✓ Manifest validation passed: OAuth2 library (v' + (oauthLib.version || 'unknown') + ') and urlFetchWhitelist configured properly.');
process.exit(0);
