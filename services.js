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

export function hasDate(iso) {
  return parseISODate(iso) !== null;
}

/** 'expired' | 'soon' | 'ok' | 'pending' (date à compléter). */
export function statusOf(iso, alertDays, today = new Date()) {
  if (!hasDate(iso)) return 'pending';
  const days = daysUntil(iso, today);
  if (days < 0) return 'expired';
  if (days <= Math.max(0, alertDays)) return 'soon';
  return 'ok';
}

export function expiryLabel(iso, today = new Date()) {
  if (!hasDate(iso)) return 'Date à compléter';
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

/** « 2 × 2 kg », « 3 unités », « 500 g » (une seule unité). */
export function quantityLabel(product) {
  const count = Math.max(1, Math.round(Number(product?.count) || 1));
  const size = String(product?.quantity ?? '').trim();
  if (count === 1) return size;
  return size ? `${count} × ${size}` : `${count} unités`;
}

const UNIT_WORDS = 'sachets?|paquets?|pots?|bo[iî]tes?|bouteilles?|briques?|packs?|filets?|barquettes?|unit[ée]s?|pi[eè]ces?|tranches?|canettes?|conserves?|bocaux|bocal';

/**
 * Sépare le nombre d'unités du poids : « 2 sachets de 2 kg » → { count: 2, quantity: '2 kg' },
 * « 4 x 125 g » → { 4, '125 g' }, « 3 » → { 3, '' }, « 2 kg » → { 1, '2 kg' }.
 */
export function splitCount(text) {
  const t = String(text ?? '').trim();
  let m = /^(\d{1,3})\s*[x×*]\s*(.+)$/i.exec(t);
  if (m) return { count: Number(m[1]), quantity: m[2].trim() };
  m = /^(\d{1,3})$/.exec(t);
  if (m) return { count: Number(m[1]), quantity: '' };
  m = new RegExp(`^(\\d{1,3})\\s+(?:${UNIT_WORDS})(?:\\s+(?:de\\s+|d')?(.+))?$`, 'i').exec(t);
  if (m) return { count: Number(m[1]), quantity: (m[2] ?? '').trim() };
  return { count: 1, quantity: t };
}

// ---------------------------------------------------------------------------
// Quantités d'une recette selon le nombre de personnes
// ---------------------------------------------------------------------------

const FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };

function parseNumber(text) {
  if (!text) return null;
  if (FRACTIONS[text] !== undefined) return FRACTIONS[text];
  const fraction = /^(\d+)\/(\d+)$/.exec(text);
  if (fraction) return Number(fraction[2]) ? Number(fraction[1]) / Number(fraction[2]) : null;
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

/** Lit « 250 g », « 1/2 oignon », « 1 ½ c. à soupe », « 2 pots » → { value, unit } ou null. */
export function parseAmount(text) {
  const m = /^\s*(\d+\/\d+|\d+(?:[.,]\d+)?|[½¼¾⅓⅔])(?:\s*([½¼¾⅓⅔]|\d+\/\d+)(?!\d))?\s*(.*)$/.exec(String(text ?? ''));
  if (!m) return null;
  const whole = parseNumber(m[1]);
  if (whole === null) return null;
  const part = m[2] ? parseNumber(m[2]) : 0;
  return { value: whole + (part ?? 0), unit: m[3].trim() };
}

function formatNumber(value) {
  return String(Math.round(value * 100) / 100).replace('.', ',');
}

/** Arrondi lisible selon l'unité : 437 g → 440 g ; 1,5 oignon → 1 ½ oignon. */
export function formatAmount(value, unit = '') {
  const u = unit.trim();
  const key = u.toLowerCase();
  let text;
  if (key === 'g' || key === 'ml') {
    const step = value >= 100 ? 10 : value >= 20 ? 5 : 1;
    text = String(Math.max(step, Math.round(value / step) * step));
  } else if (key === 'kg' || key === 'l') {
    text = formatNumber(Math.max(0.05, Math.round(value * 20) / 20));
  } else if (key === 'cl') {
    text = String(Math.max(1, Math.round(value)));
  } else {
    // Pièces, pots, cuillères… : au demi près.
    const halves = Math.max(1, Math.round(value * 2));
    const whole = Math.floor(halves / 2);
    text = halves % 2 ? (whole ? `${whole} ½` : '½') : String(whole);
  }
  return u ? `${text} ${u}` : text;
}

/** Quantité d'un ingrédient pour un facteur donné (1 = recette d'origine). */
export function scaleIngredient(ingredient, factor = 1) {
  const original = ingredient.quantity ?? '';
  if (!factor || Math.abs(factor - 1) < 1e-9) return original;
  if (Number(ingredient.amount) > 0) return formatAmount(ingredient.amount * factor, ingredient.unit ?? '');
  const parsed = parseAmount(original);
  return parsed ? formatAmount(parsed.value * factor, parsed.unit) : original; // « une pincée » : inchangé
}

// ---------------------------------------------------------------------------
// Quantité des courses : un nombre entier ; le poids éventuel va dans le nom
// ---------------------------------------------------------------------------

/** Ne garde que les chiffres (1 à 999) ; vide si rien de valable. */
export function sanitizeCount(value) {
  return String(value ?? '').replace(/\D/g, '').replace(/^0+/, '').slice(0, 3);
}

/** « Farine (1 kg) » ou « Farine 1 kg » → { base: 'Farine', size: '1 kg' }. */
export function splitItemName(name) {
  const text = String(name ?? '').trim();
  let m = /^(.*\S)\s*\(([^()]*\d[^()]*)\)$/.exec(text);
  if (m) return { base: m[1].trim(), size: m[2].trim() };
  m = /^(.*\S)\s+(\d+(?:[.,]\d+)?\s?(?:mg|g|kg|ml|cl|dl|l))$/i.exec(text);
  if (m) return { base: m[1].trim(), size: m[2].trim() };
  return { base: text, size: '' };
}

/**
 * Article de courses à partir d'une quantité libre (recette, produit du frigo) :
 * le nombre devient la quantité, le poids rejoint le nom.
 * « 2 × 1 kg » → { Farine (1 kg), '2' } ; « 400 g » → { Pâtes (400 g), '' } ; « 3 » → { Œufs, '3' }.
 */
export function toShoppingEntry(name, quantityText) {
  let { count, quantity: size } = splitCount(quantityText);
  const amount = parseAmount(size);
  if (size && amount && !amount.unit) {
    count = Math.max(1, Math.ceil(amount.value)); // « 1 ½ » → 2
    size = '';
  }
  const base = String(name ?? '').trim();
  return { name: size ? `${base} (${size})` : base, quantity: count > 1 ? String(count) : '' };
}

/** Article de courses → produit du frigo : { name, quantity (poids), count }. */
export function fromShoppingEntry(item) {
  const { base, size } = splitItemName(item.name);
  const q = String(item.quantity ?? '').trim();
  if (!q || /^\d+$/.test(q)) return { name: base, quantity: size, count: Math.max(1, Number(q) || 1) };
  const legacy = splitCount(q); // anciennes quantités libres (« 2 kg », « 2 paquets de 1 kg »)
  return { name: base, quantity: legacy.quantity || size, count: legacy.count };
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
// Rapprochement d'un ingrédient de recette avec un produit du frigo
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'au', 'aux', 'a', 'en', 'et', 'un', 'une',
  'bio', 'avec', 'sans', 'pour', 'sur', 'the', 'and', 'of']);

/** Mots significatifs d'un nom : sans accents, sans marque entre parenthèses, au singulier. */
export function nameTokens(name) {
  const text = String(name ?? '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/œ/gi, 'oe').replace(/æ/gi, 'ae')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Mots composés gardés entiers : « demi-écrémé », « pâte à tartiner ».
    .replace(/([a-z])\s*-\s*([a-z])/g, '$1-$2')
    .replace(/([a-z]{3,})\s+a\s+([a-z]{3,})/g, '$1-a-$2');
  return [...new Set(text.split(/[^a-z0-9-]+/)
    .map((t) => t.replace(/^-+|-+$/g, ''))
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
    .map((t) => (t.length > 3 ? t.replace(/[sx]$/, '') : t)))];
}

/**
 * Score de ressemblance entre deux noms (0 = différents).
 * Tous les mots du nom le plus court doivent figurer dans l'autre, et couvrir au moins
 * la moitié de ses mots : « Yaourt nature » ≈ « Yaourt nature (Danone) », mais
 * « Crème » ≠ « Crème dessert au chocolat ».
 */
export function nameMatchScore(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;
  const [small, large] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const largeSet = new Set(large);
  if (!small.every((t) => largeSet.has(t))) return 0;
  const score = small.length / large.length;
  return score >= 0.5 ? score : 0;
}

export function normalizeBarcode(code) {
  return String(code ?? '').replace(/\D/g, '').replace(/^0+/, '');
}

/**
 * Retrouve le produit du frigo correspondant à un ingrédient :
 * 1. le produit d'origine (encore au frigo) ; 2. le même code-barres (produit racheté) ;
 * 3. un nom équivalent (anciennes recettes, produits saisis sans code-barres).
 * Renvoie { product, via: 'origine' | 'code-barres' | 'nom' } ou null.
 */
export function resolveIngredient(ingredient, products) {
  if (!ingredient || ingredient.source === 'placard') return null;
  if (ingredient.productId) {
    const original = products.find((p) => p.id === ingredient.productId);
    if (original) return { product: original, via: 'origine' };
  }
  const barcode = normalizeBarcode(ingredient.barcode);
  if (barcode) {
    const same = products.find((p) => normalizeBarcode(p.barcode) === barcode);
    if (same) return { product: same, via: 'code-barres' };
  }
  let best = null;
  let bestScore = 0;
  for (const product of products) {
    if (ingredient.category && ingredient.category !== 'autre' && product.category !== 'autre'
      && product.category !== ingredient.category) continue;
    const score = Math.max(
      nameMatchScore(ingredient.name, product.name),
      ingredient.productName ? nameMatchScore(ingredient.productName, product.name) : 0
    );
    if (score > bestScore || (score > 0 && score === bestScore && product.expiry < best.expiry)) {
      best = product;
      bestScore = score;
    }
  }
  return best ? { product: best, via: 'nom' } : null;
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

/** Cuisines proposées. « monde » = Tour du monde (origines variées, hors cuisine française). */
export const ORIGINS = [
  { id: 'monde', label: 'Tour du monde', emoji: '✈️' },
  { id: 'francaise', label: 'Française', emoji: '🇫🇷' },
  { id: 'italienne', label: 'Italienne', emoji: '🇮🇹' },
  { id: 'espagnole', label: 'Espagnole', emoji: '🇪🇸' },
  { id: 'grecque', label: 'Grecque', emoji: '🇬🇷' },
  { id: 'maghrebine', label: 'Maghrébine', emoji: '🥘' },
  { id: 'libanaise', label: 'Libanaise', emoji: '🇱🇧' },
  { id: 'indienne', label: 'Indienne', emoji: '🇮🇳' },
  { id: 'chinoise', label: 'Chinoise', emoji: '🇨🇳' },
  { id: 'japonaise', label: 'Japonaise', emoji: '🇯🇵' },
  { id: 'thaie', label: 'Thaïe', emoji: '🇹🇭' },
  { id: 'vietnamienne', label: 'Vietnamienne', emoji: '🇻🇳' },
  { id: 'coreenne', label: 'Coréenne', emoji: '🇰🇷' },
  { id: 'mexicaine', label: 'Mexicaine', emoji: '🇲🇽' },
  { id: 'americaine', label: 'Américaine', emoji: '🇺🇸' },
  { id: 'africaine', label: 'Africaine', emoji: '🌍' }
];

/** Origine d'une recette (hors « Tour du monde ») ou null. */
export function originOf(id) {
  return ORIGINS.find((o) => o.id === id && o.id !== 'monde') ?? null;
}

const RECIPE_SYSTEM = `Tu es un chef cuisinier français spécialisé dans la cuisine anti-gaspillage du quotidien, pour un foyer de deux personnes.
Règles :
- Utilise en priorité les produits proches de leur date, puis les autres produits du frigo et ceux de la liste de courses.
- Les basiques du placard sont supposés disponibles (sel, poivre, huiles, vinaigre, farine, sucre, épices courantes, herbes séchées, ail, oignon, moutarde, bouillon cube) : source « placard ».
- Tout autre ingrédient nécessaire est en source « a_acheter » ; limite-les au strict minimum (2 au maximum par recette, sauf si les contraintes en autorisent davantage).
- Pour chaque ingrédient venant du frigo, renseigne ref_stock avec la référence exacte (ex. « P3 ») ; pour la liste de courses, source « courses ».
- Sécurité alimentaire : un produit dont la date est dépassée ne peut être utilisé que s'il s'agit d'une DDM (épicerie sèche, conserves, biscuits, pâtes…) après vérification de son aspect, et tu le signales dans le résumé. N'utilise jamais une viande, un poisson, un produit laitier frais ou un plat traiteur dont la date est dépassée.
- Temps réalistes (préparation + cuisson). Respecte le nombre de personnes demandé ; en batch cooking, prévois 2 à 3 repas pour ce nombre de personnes et indique le total dans portions.
- Pour chaque ingrédient, donne la quantité en texte (quantite) et, si elle est chiffrable, sa valeur numérique (valeur) et son unité (unite : g, kg, ml, cl, L, c. à soupe, c. à café, ou le nom de l'unité comme « pot », vide pour des pièces). valeur = 0 si non chiffrable (« une pincée »).
- regime : « vegan » si aucun produit d'origine animale, « vegetarien » si ni viande ni poisson ni fruits de mer (œufs et laitages autorisés), sinon « omnivore ». Sois strict (bouillon, gélatine, anchois comptent).
- calories_par_portion : estimation réaliste des kilocalories d'une portion.
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
            portions: { type: 'integer', description: 'Nombre total de portions.' },
            regime: { type: 'string', enum: ['vegan', 'vegetarien', 'omnivore'] },
            origine: { type: 'string', enum: [...ORIGINS.filter((o) => o.id !== 'monde').map((o) => o.id), 'autre'], description: "Cuisine d'origine de la recette." },
            calories_par_portion: { type: 'integer', description: 'Estimation en kcal pour une portion.' },
            batch_cooking: { type: 'boolean', description: 'true si la recette se prépare en quantité et se conserve plusieurs jours.' },
            conservation_jours: { type: 'integer', description: 'Jours de conservation au réfrigérateur après préparation.' },
            conseils_conservation: { type: 'string' },
            ingredients: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  nom: { type: 'string' },
                  quantite: { type: 'string', description: 'Quantité lisible, ex. « 250 g », « 2 pots », « une pincée ».' },
                  valeur: { type: 'number', description: 'Valeur numérique de la quantité (0 si non chiffrable).' },
                  unite: { type: 'string', description: 'Unité de valeur : g, kg, ml, cl, L, c. à soupe, c. à café, pot… ; vide pour des pièces.' },
                  source: { type: 'string', enum: ['stock', 'courses', 'placard', 'a_acheter'] },
                  ref_stock: { type: 'string', description: 'Référence du produit du frigo (ex. P3), sinon chaîne vide.' }
                },
                required: ['nom', 'quantite', 'valeur', 'unite', 'source', 'ref_stock']
              }
            },
            etapes: { type: 'array', items: { type: 'string' } }
          },
          required: ['titre', 'resume', 'difficulte', 'temps_total_minutes', 'temps_preparation_minutes',
            'portions', 'regime', 'origine', 'calories_par_portion', 'batch_cooking', 'conservation_jours', 'conseils_conservation',
            'ingredients', 'etapes']
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

export const DIETS = [
  { id: '', label: 'Tous' },
  { id: 'vegetarien', label: 'Végétarien' },
  { id: 'vegan', label: 'Vegan' }
];

export const DIET_LABEL = { vegetarien: 'Végétarien', vegan: 'Vegan' };

/** Nombre maximal d'ingrédients à acheter par recette. */
export function maxPurchases(filters) {
  return (filters.origins?.length || (filters.wish ?? '').trim()) ? 6 : 2;
}

function recipeText(recipe) {
  return [recipe.title, recipe.summary, ...(recipe.ingredients ?? []).map((i) => i.name)].join(' ');
}

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
  // Les recettes sans régime ni calories (créées avant) sont écartées par prudence.
  if (filters.diet === 'vegan' && recipe.diet !== 'vegan') return false;
  if (filters.diet === 'vegetarien' && !['vegetarien', 'vegan'].includes(recipe.diet)) return false;
  if (filters.light && !(recipe.kcal > 0 && recipe.kcal <= (filters.lightMax || 500))) return false;
  const origins = filters.origins ?? [];
  if (origins.length) {
    if (!recipe.origin) return false;
    const worldTour = origins.includes('monde');
    if (worldTour ? recipe.origin === 'francaise' : !origins.includes(recipe.origin)) return false;
  }
  // Envie libre (« nouilles », « couscous ») : au moins un de ses mots dans la recette.
  const wish = nameTokens(filters.wish ?? '');
  if (wish.length) {
    const words = new Set(nameTokens(recipeText(recipe)));
    if (!wish.some((w) => words.has(w))) return false;
  }
  return true;
}

/** Recettes enregistrées avant l'arrivée du régime et des calories. */
export function lacksNutrition(recipe) {
  return !recipe.diet || !(recipe.kcal > 0);
}

/** Recette masquée faute d'une information apparue après sa création (régime, calories, origine). */
export function lacksTagsFor(recipe, filters) {
  if ((filters.diet || filters.light) && lacksNutrition(recipe)) return true;
  return Boolean(filters.origins?.length) && !recipe.origin;
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
  const origins = (filters.origins ?? []).filter((id) => id !== 'monde').map((id) => originOf(id)?.label.toLowerCase()).filter(Boolean);
  if (filters.origins?.includes('monde')) {
    lines.push('Tour du monde : 5 recettes de cuisines du monde toutes différentes (pas de cuisine française).');
  } else if (origins.length === 1) {
    lines.push(`Toutes les recettes doivent être de cuisine ${origins[0]}.`);
  } else if (origins.length > 1) {
    lines.push(`Cuisines demandées : ${origins.join(', ')}. Répartis les recettes entre ces origines (au moins une de chaque si possible).`);
  }
  if ((filters.wish ?? '').trim()) {
    lines.push(`Envie de l'utilisateur : « ${filters.wish.trim()} ». Toutes les recettes doivent y répondre.`);
  }
  if (maxPurchases(filters) > 2) {
    lines.push(`Recettes fidèles à leur cuisine d'origine : utilise les produits du frigo quand ils s'y prêtent, mais tu peux prévoir jusqu'à ${maxPurchases(filters)} ingrédients à acheter par recette (sauces, épices, féculents typiques).`);
  }
  if (filters.diet === 'vegetarien') {
    lines.push('Toutes les recettes doivent être végétariennes : ni viande, ni poisson, ni fruits de mer (œufs et produits laitiers autorisés). Ignore les produits du frigo incompatibles.');
  } else if (filters.diet === 'vegan') {
    lines.push("Toutes les recettes doivent être vegan : aucun produit d'origine animale (ni viande, poisson, œufs, lait, beurre, crème, fromage, miel). Ignore les produits du frigo incompatibles.");
  }
  if (filters.light) {
    lines.push(`Recettes légères : au plus ${filters.lightMax || 500} kcal par portion.`);
  }
  lines.push(filters.batchOnly
    ? 'Toutes les recettes doivent convenir au batch cooking : préparées en plusieurs portions et se conservant au moins 3 jours au réfrigérateur (batch_cooking = true, conservation_jours ≥ 3).'
    : 'Inclue au moins une recette adaptée au batch cooking (se conserve plusieurs jours).');
  return lines;
}

function promptExpiry(iso) {
  if (!hasDate(iso)) return 'date de péremption non renseignée';
  const days = daysUntil(iso);
  if (days < 0) return `date dépassée depuis ${-days} j`;
  if (days === 0) return "expire aujourd'hui";
  if (days === 1) return 'expire demain';
  return `expire dans ${days} j`;
}

/**
 * priority / others : produits { id, name, quantity, category, expiry }
 * shopping : articles { name, quantity, checked }
 */
export async function generateRecipes({ key, model, priority, others, shopping, filters, servings = 2, count = 5 }) {
  const refs = new Map();
  let index = 0;
  const describe = (p) => {
    index += 1;
    refs.set(`P${index}`, p.id);
    const parts = [`[P${index}] ${p.name}`];
    if (quantityLabel(p)) parts.push(`quantité : ${quantityLabel(p)}`);
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
    `- Pour ${servings} personne${servings > 1 ? 's' : ''} (portions = ${servings}, sauf batch cooking).`,
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
      let product = all.find((p) => p.id === refs.get(ref)) ?? null;
      if (!product && source === 'stock') {
        product = all
          .map((p) => ({ p, score: nameMatchScore(item.nom, p.name) }))
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score)[0]?.p ?? null;
      }
      if (product) source = 'stock';
      return {
        name: item.nom ?? '',
        quantity: item.quantite ?? '',
        amount: Number(item.valeur) > 0 ? Number(item.valeur) : null,
        unit: String(item.unite ?? '').trim(),
        source,
        productId: product?.id ?? null,
        // Mémorisés pour retrouver le produit s'il est racheté plus tard.
        barcode: product?.barcode ?? '',
        productName: product?.name ?? '',
        category: product?.category ?? ''
      };
    });
    return {
      id: crypto.randomUUID(),
      title: r.titre ?? 'Recette',
      summary: r.resume ?? '',
      difficulty: ['facile', 'moyen', 'difficile'].includes(r.difficulte) ? r.difficulte : 'moyen',
      totalMinutes: Number(r.temps_total_minutes) || 30,
      prepMinutes: Number(r.temps_preparation_minutes) || 15,
      servings: Number(r.portions) || servings,
      diet: ['vegan', 'vegetarien', 'omnivore'].includes(r.regime) ? r.regime : 'omnivore',
      origin: originOf(r.origine) ? r.origine : 'autre',
      kcal: Number(r.calories_par_portion) > 0 ? Math.round(Number(r.calories_par_portion)) : null,
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

/**
 * Lit un ticket de caisse (une ou plusieurs photos, de haut en bas).
 * Renvoie les produits alimentaires : [{ name, receiptText, category, count, quantity }].
 * Les dates de péremption ne figurent pas sur un ticket : elles restent « à compléter ».
 */
export async function analyzeReceipt({ key, model, images }) {
  const categoryIds = CATEGORIES.map((c) => c.id);
  const content = images.map((data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }));
  content.push({
    type: 'text',
    text: `${images.length > 1 ? `Voici un ticket de caisse en ${images.length} photos, de haut en bas.` : 'Voici un ticket de caisse.'}
Liste uniquement les produits alimentaires et les boissons achetés.
- Ignore : hygiène, entretien, sacs, remises, consignes, bons d'achat, sous-totaux, totaux, moyens de paiement.
- Développe les abréviations en un nom clair en français (ex. « PDT CONSO 2KG » → nom « Pommes de terre », contenance « 2 kg »).
- nombre : quantité achetée de ce produit (ex. ligne « 2 x 1,19 » ou ligne répétée → 2). Regroupe les lignes identiques.
- contenance : poids ou volume d'une unité s'il est indiqué (« 500 g », « 1 L »), sinon chaîne vide.
- Si les photos se chevauchent, ne compte pas deux fois la même ligne.
- Si la photo n'est pas un ticket de caisse, renvoie une liste vide.`
  });
  const input = await callTool({
    key, model,
    system: 'Tu lis des tickets de caisse de supermarchés français pour une application anti-gaspillage. Sois précis ; n\'invente aucun produit.',
    tool: {
      name: 'lister_produits',
      description: 'Liste les produits alimentaires du ticket de caisse.',
      input_schema: {
        type: 'object',
        properties: {
          produits: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                nom: { type: 'string', description: 'Nom clair en français.' },
                texte_ticket: { type: 'string', description: 'Libellé tel qu\'imprimé sur le ticket.' },
                categorie: { type: 'string', enum: categoryIds },
                nombre: { type: 'integer', description: "Nombre d'unités achetées (1 par défaut)." },
                contenance: { type: 'string', description: 'Poids ou volume d\'une unité, sinon chaîne vide.' }
              },
              required: ['nom', 'texte_ticket', 'categorie', 'nombre', 'contenance']
            }
          }
        },
        required: ['produits']
      }
    },
    content,
    maxTokens: 4000,
    timeoutMs: 120_000
  });

  return (input.produits ?? [])
    .filter((item) => (item.nom ?? '').trim())
    .map((item) => ({
      name: item.nom.trim(),
      receiptText: (item.texte_ticket ?? '').trim(),
      category: categoryIds.includes(item.categorie) ? item.categorie : 'autre',
      count: Math.min(99, Math.max(1, Math.round(Number(item.nombre) || 1))),
      quantity: (item.contenance ?? '').trim()
    }));
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

/**
 * Ouvre la caméra arrière dans l'élément vidéo.
 * Gérée ici plutôt que par ZXing : si iOS refuse de lancer la vidéo, ZXing l'ignore
 * en silence et l'écran reste noir. Renvoie { stream, playing, stop }.
 */
export async function startCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('Caméra non disponible dans ce navigateur.'), { name: 'NotSupportedError' });
  }
  const attempts = [
    { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
    { audio: false, video: { facingMode: 'environment' } },
    { audio: false, video: true }
  ];
  let stream = null;
  let lastError = null;
  for (const constraints of attempts) {
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      break;
    } catch (error) {
      lastError = error;
      if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') throw error;
    }
  }
  if (!stream) throw lastError ?? new Error('Caméra indisponible.');

  // Indispensables sur iPhone pour lire la vidéo sans plein écran ni son.
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.srcObject = stream;

  let playing = true;
  try {
    await video.play();
  } catch {
    playing = false; // iOS attend un toucher : l'interface proposera « Démarrer la caméra »
  }
  const stop = () => {
    stream.getTracks().forEach((track) => track.stop());
    video.pause?.();
    video.srcObject = null;
  };
  return { stream, playing, stop };
}

/**
 * Renvoie une fonction (canvas) => code | null.
 * Utilise le détecteur natif du navigateur s'il existe, sinon ZXing.
 */
export async function createBarcodeDecoder() {
  if ('BarcodeDetector' in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'].filter((f) => supported.includes(f));
      if (formats.length) {
        const detector = new window.BarcodeDetector({ formats });
        return async (canvas) => (await detector.detect(canvas))[0]?.rawValue ?? null;
      }
    } catch {
      // on passe à ZXing
    }
  }
  const reader = await barcodeReader();
  return async (canvas) => {
    try {
      return reader.decodeFromCanvas(canvas).getText();
    } catch {
      return null; // aucun code dans cette image
    }
  };
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
