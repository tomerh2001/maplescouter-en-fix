const fs = require('node:fs');
const path = require('node:path');

// Keep weekly reviews separate from the original extraction pipeline. Both build paths
// apply these files last so a future full merge cannot erase reviewed translations.
function applyTranslationOverrides(i18nPatch, dict) {
  const dir = path.join(__dirname, '..', 'data', 'overrides');
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.json')).sort()) {
    const entries = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    for (const [key, value] of Object.entries(entries)) {
      if (!key || typeof value !== 'string' || !value.trim()) throw new Error('Invalid translation in ' + name);
      i18nPatch[key] = value;
      dict[key] = value;
      // The legacy DOM dictionary must not rewrite the English we just reviewed.
      if (!/[가-힣]/.test(value) && dict[value] && dict[value] !== value) delete dict[value];
    }
  }
}
module.exports = { applyTranslationOverrides };
