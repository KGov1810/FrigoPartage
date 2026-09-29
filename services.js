// Frigo partagé — services sans interface : dates, lecture de date (OCR),
// Open Food Facts, Claude, images, scanner de code-barres.

// ---------------------------------------------------------------------------
// Catégories
// ---------------------------------------------------------------------------

export const CATEGORIES = [
  { id: 'fruits_legumes', label: 'Fruits et légumes', emoji: '🥕' },
  { id: 'viande', label: 'Viande et charcuterie', emoji: '🥩' },
  { id: 'poisson', label: 'Poisson et fruits de mer', emoji: '🐟' },
  { id: 'laitier', label: 'Produits laitiers et œufs', emoji: '🧀' },
  { id: 'traiteur', label: 'Traiteur et plats préparés', emoji: '🍱' },
  { id: 'epicerie', label: 'Épicerie', emoji: '🥫' },
  { id: 'surgele', label: 'Surgelés', emoji: '🧊' },
  { id: 'boulangerie', label: 'Boulangerie', emoji: '🥖' },
  { id: 'boisson', label: 'Boissons', emoji: '🧃' },
  { id: 'autre', label: 'Autre', emoji: '🛒' }
];

export function category(id) {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1];
}

// ---------------------------------------------------------------------------
// Dates (format « AAAA-MM-JJ », en heure locale)
// ---------------------------------------------------------------------------

const DAY = 86_400_000;

export function startOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseISODate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!match) return null;
  return makeDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

export function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function isoInDays(days, today = new Date()) {
  return toISODate(addDays(startOfDay(today), days));
}

/** Jours calendaires restants (négatif si la date est dépassée). */
export function daysUntil(iso, today = new Date()) {
  const date = parseISODate(iso);
  if (!date) return 0;
  return Math.round((date - startOfDay(today)) / DAY);
}

export function statusOf(iso, alertDays, today = new Date()) {
  const days = daysUntil(iso, today);
  if (days < 0) return 'expired';
  if (days <= Math.max(0, alertDays)) return 'soon';
  return 'ok';
}

export function expiryLabel(iso, today = new Date()) {
  const days = daysUntil(iso, today);
  if (days < -1) return `Périmé depuis ${-days} jours`;
  if (days === -1) return 'Périmé depuis hier';
  if (days === 0) return "Expire aujourd'hui";
  if (days === 1) return 'Expire demain';
  if (days <= 30) return `Expire dans ${days} jours`;
  return `Jusqu'au ${formatDate(iso, { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

export function formatDate(iso, options = { day: 'numeric', month: 'short' }) {
  const date = parseISODate(iso);
  return date ? date.toLocaleDateString('fr-FR', options) : '';
}

export function plural(count, singular, pluralForm) {
  return `${count} ${count > 1 ? (pluralForm ?? `${singular}s`) : singular}`;
}

function makeDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

// ---------------------------------------------------------------------------
// Lecture de la date de péremption dans un texte OCR
// ---------------------------------------------------------------------------

const POSITIVE = ['consommer', 'dlc', 'ddm', 'dluo', 'exp', 'avant', 'jusqu', 'best before',
  'use by', 'bbe', 'peremption', 'preference', 'a conso'];
const NEGATIVE = ['emball', 'fabriq', 'produit le', 'fab.', 'abattu', 'peche le'];
const SEP = String.raw`(?:\s?[.\/\-]\s?|\s)`;
const NUMERIC = new RegExp(String.raw`(?<!\d)(\d{1,2})${SEP}(\d{1,2})${SEP}(\d{4}|\d{2})(?!\d)`, 'g');
const ISO = /(?<!\d)(\d{4})[.\/\-](\d{1,2})[.\/\-](\d{1,2})(?!\d)/g;
const MONTH_NAME = /(?<!\d)(\d{1,2})(?:er)?\s*([a-z]{3,9})\.?\s*(\d{4}|\d{2})(?!\d)/g;
const MONTH_YEAR = /(?<![\d.\/\-])(\d{1,2})\s?[.\/\-]\s?(\d{4})(?!\d)/g;
const MONTHS = [['janv', 1], ['jan', 1], ['fev', 2], ['feb', 2], ['mar', 3], ['avr', 4], ['apr', 4],
  ['mai', 5], ['may', 5], ['juin', 6], ['jun', 6], ['juil', 7], ['jul', 7], ['aou', 8], ['aug', 8],
  ['sep', 9], ['oct', 10], ['nov', 11], ['dec', 12]];

function normalizeLine(line) {
  return line
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Confusions fréquentes de l'OCR au milieu d'une date : O→0, l/i→1.
    .replace(/(?<=[\d.\/\-])[o](?=[\d.\/\-])/g, '0')
    .replace(/(?<=[\d.\/\-])[li](?=[\d.\/\-])/g, '1');
}

function expandYear(raw) {
  if (raw.length === 2) return 2000 + Number(raw);
  if (raw.length === 4) return Number(raw);
  return null;
}

function datesInLine(line) {
  const found = [];
  for (const m of line.matchAll(NUMERIC)) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = expandYear(m[3]);
    const bonus = m[3].length === 4 ? 1 : 0;
    const date = makeDate(year, month, day);
    if (date) found.push({ date, bonus });
    else {
      const us = makeDate(year, day, month); // format américain MM/JJ, moins probable
      if (us) found.push({ date: us, bonus: bonus - 1 });
    }
  }
  for (const m of line.matchAll(ISO)) {
    const date = makeDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (date) found.push({ date, bonus: 1 });
  }
  for (const m of line.matchAll(MONTH_NAME)) {
    const month = MONTHS.find(([prefix]) => m[2].startsWith(prefix))?.[1];
    if (!month) continue;
    const date = makeDate(expandYear(m[3]), month, Number(m[1]));
    if (date) found.push({ date, bonus: 1 });
  }
  for (const m of line.matchAll(MONTH_YEAR)) {
    const month = Number(m[1]);
    const year = Number(m[2]);
    if (month < 1 || month > 12) continue;
    found.push({ date: new Date(year, month, 0), bonus: -1 }); // dernier jour du mois
  }
  return found;
}

/**
 * Renvoie la date de péremption la plus probable (« AAAA-MM-JJ ») ou null.
 * Privilégie les dates précédées de « à consommer », « DLC », « EXP »…
 * et écarte « emballé le », « fabriqué le ».
 */
export function parseExpiryDate(lines, today = new Date()) {
  const start = startOfDay(today);
  const min = addDays(start, -60);
  const max = new Date(start.getFullYear() + 5, start.getMonth(), start.getDate());
  const normalized = lines.map(normalizeLine);
  const candidates = [];

  normalized.forEach((line, index) => {
    const previous = index > 0 ? normalized[index - 1] : '';
    let context = 0;
    if (POSITIVE.some((k) => line.includes(k))) context += 3;
    else if (POSITIVE.some((k) => previous.includes(k))) context += 2;
    if (NEGATIVE.some((k) => line.includes(k))) context -= 3;

    for (const { date, bonus } of datesInLine(line)) {
      if (date < min || date > max) continue;
      const score = 1 + context + bonus + (date >= start ? 1 : 0);
      candidates.push({ date, score });
    }
  });

  candidates.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    const aFuture = a.date >= start;
    const bFuture = b.date >= start;
    if (aFuture !== bFuture) return aFuture ? -1 : 1;
    return Math.abs(a.date - start) - Math.abs(b.date - start);
  });
  return candidates.length ? toISODate(candidates[0].date) : null;
}

// ---------------------------------------------------------------------------
// Chargement paresseux des bibliothèques externes
// ---------------------------------------------------------------------------

const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.1/umd/zxing-browser.min.js';
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';
const loadedScripts = new Map();

function loadScript(src) {
  if (!loadedScripts.has(src)) {
    loadedScripts.set(src, new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => {
        loadedScripts.delete(src);
        reject(new Error('Bibliothèque non téléchargée : vérifiez la connexion internet.'));
      };
      document.head.append(script);
    }));
  }
  return loadedScripts.get(src);
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Photo illisible.'));
    img.src = src;
  });
}

/** Redimensionne une photo (l'orientation de l'appareil est respectée par Safari). */
export async function resizeImage(blob, maxDimension = 1568, quality = 0.8) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    return { canvas, dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Vignette légère (≈ 30 Ko) stockée avec le produit. */
export async function thumbnail(blob) {
  return (await resizeImage(blob, 400, 0.6)).dataUrl;
}

// ---------------------------------------------------------------------------
// Open Food Facts (base collaborative, licence ODbL)
// ---------------------------------------------------------------------------

const OFF_RULES = [
  ['surgele', ['frozen']],
  ['boisson', ['beverages', 'drinks', 'waters', 'juices', 'sodas', 'wines', 'beers']],
  ['laitier', ['dairies', 'cheeses', 'yogurts', 'milks', 'butters', 'creams', 'eggs']],
  ['poisson', ['fishes', 'fish', 'seafood', 'smoked-salmons', 'crustaceans']],
  ['viande', ['meats', 'poultry', 'hams', 'sausages', 'charcuteries', 'chickens', 'beef', 'pork']],
  ['boulangerie', ['breads', 'viennoiseries', 'pastries', 'brioches']],
  ['traiteur', ['meals', 'prepared', 'salads', 'pizzas', 'sandwiches', 'dips', 'quiches', 'fresh-pastas']],
  ['fruits_legumes', ['fruits', 'vegetables', 'fresh-plant']]
];

export function categoryFromTags(tags = []) {
  if (!tags.length) return 'autre';
  const joined = tags.join(' ').toLowerCase();
  for (const [id, keywords] of OFF_RULES) {
    if (keywords.some((k) => joined.includes(k))) return id;
  }
  return 'epicerie';
}

/** Renvoie { name, quantity, category, imageUrl } ou null si le code est inconnu. */
export async function lookupBarcode(code) {
  const digits = String(code).replace(/\D/g, '');
  if (digits.length < 6) return null;
  const fields = 'product_name,product_name_fr,generic_name_fr,brands,quantity,image_front_small_url,categories_tags';
  const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${digits}.json?fields=${fields}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Open Food Facts indisponible (${response.status}).`);
  const json = await response.json();
  const product = json.product;
  if (json.status !== 1 || !product) return null;

  const baseName = [product.product_name_fr, product.product_name, product.generic_name_fr]
    .map((s) => (s ?? '').trim()).find(Boolean);
  if (!baseName) return null;
  const brand = (product.brands ?? '').split(',')[0].trim();
  const name = brand && !baseName.toLowerCase().includes(brand.toLowerCase())
    ? `${baseName} (${brand})` : baseName;

  return {
    name,
    quantity: (product.quantity ?? '').trim(),
    category: categoryFromTags(product.categories_tags),
    imageUrl: product.image_front_small_url ?? ''
  };
}

// ---------------------------------------------------------------------------
// Claude (API Messages, sortie structurée via un outil imposé)
// ---------------------------------------------------------------------------

export class ClaudeError extends Error {}

async function callTool({ key, model, system, content, tool, maxTokens, timeoutMs }) {
  if (!key) throw new ClaudeError('Ajoutez votre clé API Claude dans Réglages pour utiliser cette fonction.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        // Autorise l'appel direct depuis le navigateur (clé propre à l'utilisateur).
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content }]
      })
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new ClaudeError('Claude met trop de temps à répondre, réessayez.');
    throw new ClaudeError('Connexion à Claude impossible : vérifiez la connexion internet.');
  } finally {
    clearTimeout(timer);
  }

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message = json?.error?.message ?? `code ${response.status}`;
    if (response.status === 401) throw new ClaudeError('Clé API Claude refusée : vérifiez-la dans Réglages.');
    if (response.status === 429) throw new ClaudeError('Trop de demandes envoyées à Claude, réessayez dans une minute.');
    if (response.status === 529 || response.status === 503) throw new ClaudeError('Claude est surchargé pour le moment, réessayez un peu plus tard.');
    if (/credit balance/i.test(message)) throw new ClaudeError('Crédit Claude épuisé : ajoutez du crédit sur console.anthropic.com.');
    throw new ClaudeError(`Erreur Claude : ${message}`);
  }
  if (json?.stop_reason === 'max_tokens') throw new ClaudeError('La réponse de Claude a été coupée, réessayez.');
  const block = json?.content?.find((b) => b.type === 'tool_use');
  if (!block?.input) throw new ClaudeError('Réponse inattendue de Claude, réessayez.');
  return block.input;
}

const RECIPE_SYSTEM = `Tu es un chef cuisinier français spécialisé dans la cuisine anti-gaspillage du quotidien, pour un foyer de deux personnes.
Règles :
- Utilise en priorité les produits proches de leur date, puis les autres produits du frigo et ceux de la liste de courses.
- Les basiques du placard sont supposés disponibles (sel, poivre, huiles, vinaigre, farine, sucre, épices courantes, herbes séchées, ail, oignon, moutarde, bouillon cube) : source « placard ».
- Tout autre ingrédient nécessaire est en source « a_acheter » ; limite-les au strict minimum (2 au maximum par recette).
- Pour chaque ingrédient venant du frigo, renseigne ref_stock avec la référence exacte (ex. « P3 ») ; pour la liste de courses, source « courses ».
- Sécurité alimentaire : un produit dont la date est dépassée ne peut être utilisé que s'il s'agit d'une DDM (épicerie sèche, conserves, biscuits, pâtes…) après vérification de son aspect, et tu le signales dans le résumé. N'utilise jamais une viande, un poisson, un produit laitier frais ou un plat traiteur dont la date est dépassée.
- Temps réalistes (préparation + cuisson). Portions pour 2 personnes, ou 4 à 6 portions pour le batch cooking.
- conservation_jours : durée réaliste au réfrigérateur en boîte hermétique (0 si le plat se mange tout de suite) ; précise dans conseils_conservation comment conserver, réchauffer, et si le plat se congèle.
- Étapes courtes et claires, une action par étape, en français.`;

const RECIPE_TOOL = {
  name: 'proposer_recettes',
  description: "Enregistre les recettes proposées à l'utilisateur.",
  input_schema: {
    type: 'object',
    properties: {
      recettes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            titre: { type: 'string' },
            resume: { type: 'string', description: 'Une ou deux phrases appétissantes.' },
            difficulte: { type: 'string', enum: ['facile', 'moyen', 'difficile'] },
            temps_total_minutes: { type: 'integer', description: 'Préparation + cuisson, en minutes.' },
            temps_preparation_minutes: { type: 'integer' },
            portions: { type: 'integer' },
            batch_cooking: { type: 'boolean', description: 'true si la recette se prépare en quantité et se conserve plusieurs jours.' },
            conservation_jours: { type: 'integer', description: 'Jours de conservation au réfrigérateur après préparation.' },
            conseils_conservation: { type: 'string' },
            ingredients: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  nom: { type: 'string' },
                  quantite: { type: 'string' },
                  source: { type: 'string', enum: ['stock', 'courses', 'placard', 'a_acheter'] },
                  ref_stock: { type: 'string', description: 'Référence du produit du frigo (ex. P3), sinon chaîne vide.' }
                },
                required: ['nom', 'quantite', 'source', 'ref_stock']
              }
            },
            etapes: { type: 'array', items: { type: 'string' } }
          },
          required: ['titre', 'resume', 'difficulte', 'temps_total_minutes', 'temps_preparation_minutes',
            'portions', 'batch_cooking', 'conservation_jours', 'conseils_conservation', 'ingredients', 'etapes']
        }
      }
    },
    required: ['recettes']
  }
};

export const DIFFICULTIES = [
  { id: 'facile', label: 'Facile' },
  { id: 'moyen', label: 'Moyen' },
  { id: 'difficile', label: 'Difficile' }
];

export const TIME_FILTERS = [
  { max: 0, label: 'Peu importe' },
  { max: 15, label: '15 min' },
  { max: 30, label: '30 min' },
  { max: 60, label: '1 h' }
];

export function isBatchFriendly(recipe) {
  return recipe.batchCooking && recipe.storageDays >= 2;
}

export function matchesFilters(recipe, filters) {
  if (filters.difficulty && recipe.difficulty !== filters.difficulty) return false;
  if (filters.maxMinutes && recipe.totalMinutes > filters.maxMinutes) return false;
  if (filters.batchOnly && !isBatchFriendly(recipe)) return false;
  return true;
}

export function formatMinutes(minutes) {
  if (minutes < 60) return `${Math.max(0, minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

function filterLines(filters) {
  const lines = [];
  lines.push(filters.difficulty
    ? `Toutes les recettes doivent être de difficulté « ${filters.difficulty} ».`
    : 'Varie les niveaux de difficulté, avec une majorité de recettes faciles.');
  if (filters.maxMinutes) {
    lines.push(`Temps total (préparation + cuisson) inférieur ou égal à ${filters.maxMinutes} minutes pour chaque recette.`);
  }
  lines.push(filters.batchOnly
    ? 'Toutes les recettes doivent convenir au batch cooking : préparées en plusieurs portions et se conservant au moins 3 jours au réfrigérateur (batch_cooking = true, conservation_jours ≥ 3).'
    : 'Inclue au moins une recette adaptée au batch cooking (se conserve plusieurs jours).');
  return lines;
}

function promptExpiry(iso) {
  const days = daysUntil(iso);
  if (days < 0) return `date dépassée depuis ${-days} j`;
  if (days === 0) return "expire aujourd'hui";
  if (days === 1) return 'expire demain';
  return `expire dans ${days} j`;
}

function simplify(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * priority / others : produits { id, name, quantity, category, expiry }
 * shopping : articles { name, quantity, checked }
 */
export async function generateRecipes({ key, model, priority, others, shopping, filters, count = 5 }) {
  const refs = new Map();
  let index = 0;
  const describe = (p) => {
    index += 1;
    refs.set(`P${index}`, p.id);
    const parts = [`[P${index}] ${p.name}`];
    if (p.quantity) parts.push(`quantité : ${p.quantity}`);
    parts.push(category(p.category).label.toLowerCase(), promptExpiry(p.expiry));
    return `- ${parts.join(' – ')}`;
  };
  const priorityLines = priority.map(describe);
  const otherLines = others.map(describe);
  const shoppingLines = shopping.map((i) => `- ${i.name}${i.quantity ? ` (${i.quantity})` : ''}${i.checked ? ' – déjà acheté' : ''}`);
  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const prompt = [
    `Nous sommes le ${today}.`,
    '',
    'PRODUITS À UTILISER EN PRIORITÉ (proches de leur date) :',
    priorityLines.length ? priorityLines.join('\n') : '(aucun : pioche librement dans le stock)',
    '',
    'AUTRES PRODUITS DISPONIBLES AU FRIGO / PLACARD :',
    otherLines.length ? otherLines.join('\n') : '(aucun)',
    '',
    'LISTE DE COURSES (articles prévus ou achetés, utilisables) :',
    shoppingLines.length ? shoppingLines.join('\n') : '(vide)',
    '',
    'CONTRAINTES :',
    `- Propose exactement ${count} recettes variées (pas deux fois le même type de plat).`,
    ...(priorityLines.length ? ["- Chaque recette doit utiliser au moins un produit prioritaire ; l'ensemble des recettes doit couvrir tous les produits prioritaires utilisables."] : []),
    ...filterLines(filters).map((l) => `- ${l}`),
    '',
    "Réponds uniquement avec l'outil proposer_recettes."
  ].join('\n');

  const input = await callTool({
    key, model, system: RECIPE_SYSTEM, tool: RECIPE_TOOL,
    content: [{ type: 'text', text: prompt }], maxTokens: 8000, timeoutMs: 180_000
  });

  const all = [...priority, ...others];
  const now = Date.now();
  return (input.recettes ?? []).map((r, i) => {
    const ingredients = (r.ingredients ?? []).map((item) => {
      let source = ['stock', 'courses', 'placard', 'a_acheter'].includes(item.source) ? item.source : 'a_acheter';
      const ref = String(item.ref_stock ?? '').replace(/[[\]\s]/g, '').toUpperCase();
      let productId = refs.get(ref) ?? null;
      if (!productId && source === 'stock') {
        const needle = simplify(item.nom ?? '');
        productId = all.find((p) => {
          const hay = simplify(p.name);
          return needle && (hay.includes(needle) || needle.includes(hay));
        })?.id ?? null;
      }
      if (productId) source = 'stock';
      return { name: item.nom ?? '', quantity: item.quantite ?? '', source, productId };
    });
    return {
      id: crypto.randomUUID(),
      title: r.titre ?? 'Recette',
      summary: r.resume ?? '',
      difficulty: ['facile', 'moyen', 'difficile'].includes(r.difficulte) ? r.difficulte : 'moyen',
      totalMinutes: Number(r.temps_total_minutes) || 30,
      prepMinutes: Number(r.temps_preparation_minutes) || 15,
      servings: Number(r.portions) || 2,
      batchCooking: Boolean(r.batch_cooking),
      storageDays: Number(r.conservation_jours) || 0,
      storageTips: r.conseils_conservation ?? '',
      ingredients,
      steps: r.etapes ?? [],
      usedProductIds: [...new Set(ingredients.map((x) => x.productId).filter(Boolean))],
      createdAt: now - i, // conserve l'ordre de Claude
      favorite: false
    };
  });
}

/** Analyse la photo d'un produit : { isFood, name, category, quantity, expiry } */
export async function analyzeProduct({ key, model, base64 }) {
  const categoryIds = CATEGORIES.map((c) => c.id);
  const input = await callTool({
    key, model,
    system: 'Tu identifies des produits alimentaires photographiés pour une application anti-gaspillage française. Sois précis et prudent.',
    tool: {
      name: 'decrire_produit',
      description: 'Décrit le produit alimentaire visible sur la photo.',
      input_schema: {
        type: 'object',
        properties: {
          est_alimentaire: { type: 'boolean' },
          nom: { type: 'string', description: 'Nom court en français : type de produit + marque si visible (ex. Yaourt nature Danone).' },
          categorie: { type: 'string', enum: categoryIds },
          quantite: { type: 'string', description: 'Poids, volume ou nombre si visible, sinon chaîne vide.' },
          date_peremption: { type: 'string', description: 'Date DLC/DDM lisible au format AAAA-MM-JJ, sinon chaîne vide.' }
        },
        required: ['est_alimentaire', 'nom', 'categorie', 'quantite', 'date_peremption']
      }
    },
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
      {
        type: 'text',
        text: `Identifie ce produit alimentaire photographié. Nous sommes le ${toISODate(new Date())}.
Si une date de péremption (« à consommer jusqu'au », « à consommer de préférence avant », DLC, DDM, EXP) est lisible, donne-la au format AAAA-MM-JJ ; si seuls le mois et l'année figurent, prends le dernier jour du mois.
N'invente jamais de date : laisse une chaîne vide si elle n'est pas lisible.`
      }
    ],
    maxTokens: 1024,
    timeoutMs: 60_000
  });

  let expiry = null;
  const date = parseISODate(input.date_peremption);
  if (date) {
    const start = startOfDay();
    const max = new Date(start.getFullYear() + 5, start.getMonth(), start.getDate());
    if (date >= addDays(start, -60) && date <= max) expiry = toISODate(date);
  }
  return {
    isFood: input.est_alimentaire !== false,
    name: (input.nom ?? '').trim(),
    category: categoryIds.includes(input.categorie) ? input.categorie : 'autre',
    quantity: (input.quantite ?? '').trim(),
    expiry
  };
}

// ---------------------------------------------------------------------------
// OCR gratuit sur l'iPhone (Tesseract, téléchargé au premier usage)
// ---------------------------------------------------------------------------

let ocrWorker = null;

export async function recognizeText(blob) {
  await loadScript(TESSERACT_URL);
  if (!ocrWorker) {
    ocrWorker = window.Tesseract.createWorker('fra').catch((error) => {
      ocrWorker = null;
      throw error;
    });
  }
  const worker = await ocrWorker;
  const { canvas } = await resizeImage(blob, 1800, 0.92);
  const { data } = await worker.recognize(canvas);
  return (data.text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Code-barres (ZXing) : caméra en direct ou photo
// ---------------------------------------------------------------------------

const TRY_HARDER = 3; // valeur de DecodeHintType.TRY_HARDER dans ZXing

async function barcodeReader() {
  await loadScript(ZXING_URL);
  return new window.ZXingBrowser.BrowserMultiFormatOneDReader(
    new Map([[TRY_HARDER, true]]),
    { delayBetweenScanAttempts: 120, tryPlayVideoTimeout: 8000 }
  );
}

/** Démarre la caméra et appelle onCode une seule fois. Renvoie une fonction d'arrêt. */
export async function startBarcodeScan(video, onCode) {
  const reader = await barcodeReader();
  let found = false;
  const controls = await reader.decodeFromConstraints(
    { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
    video,
    (result) => {
      if (result && !found) {
        found = true;
        onCode(result.getText());
      }
    }
  );
  return () => controls.stop();
}

export async function decodeBarcodeFromImage(blob) {
  const reader = await barcodeReader();
  const { dataUrl } = await resizeImage(blob, 1600, 0.95);
  try {
    return (await reader.decodeFromImageUrl(dataUrl)).getText();
  } catch {
    return null;
  }
}
