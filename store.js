// Frigo partagé — état de l'app et synchronisation Firebase (Firestore).
// Données partagées : foyers/{code}/produits, /courses, /recettes.
// Réglages propres à chaque iPhone : localStorage.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, memoryLocalCache,
  collection, doc, setDoc, deleteDoc, getDoc, onSnapshot, writeBatch, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { statusOf, daysUntil } from './services.js';

// ---------------------------------------------------------------------------
// Réglages locaux
// ---------------------------------------------------------------------------

const SETTINGS_KEY = 'frigo.settings.v1';
const DEFAULT_SETTINGS = {
  userName: '',
  alertDays: 2,
  claudeKey: '',
  model: 'claude-sonnet-5-5',
  householdCode: '',
  firebaseConfig: null,
  onboardingDone: false,
  installHintDismissed: false
};

export const MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 (recommandé)' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5 (rapide, économique)' }
];

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function updateSettings(patch) {
  Object.assign(state.settings, patch);
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  } catch {
    // stockage indisponible (navigation privée) : les réglages restent en mémoire
  }
  emit('settings');
}

// ---------------------------------------------------------------------------
// État observable
// ---------------------------------------------------------------------------

export const state = {
  settings: loadSettings(),
  products: [],
  shopping: [],
  recipes: [],
  connected: false,
  fromCache: true,
  pending: false,
  error: null,
  lastSync: null
};

const subscribers = new Set();

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function emit(what) {
  for (const fn of subscribers) {
    try {
      fn(what);
    } catch (error) {
      console.error(error);
    }
  }
}

// ---------------------------------------------------------------------------
// Vues dérivées
// ---------------------------------------------------------------------------

export function sortedProducts() {
  return [...state.products].sort((a, b) => a.expiry.localeCompare(b.expiry) || a.name.localeCompare(b.name, 'fr'));
}

export function productStatus(product) {
  return statusOf(product.expiry, state.settings.alertDays);
}

export function urgentProducts() {
  return sortedProducts().filter((p) => productStatus(p) !== 'ok');
}

export function soonProducts() {
  return sortedProducts().filter((p) => productStatus(p) === 'soon');
}

export function productById(id) {
  return state.products.find((p) => p.id === id) ?? null;
}

export function uncheckedCount() {
  return state.shopping.filter((i) => !i.checked).length;
}

export function syncLabel() {
  if (!firebaseConfig()) return 'Firebase non configuré';
  if (!state.settings.householdCode) return 'Aucun foyer';
  if (state.error) return 'Erreur de synchronisation';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return state.pending ? 'Hors ligne, envoi en attente' : 'Hors ligne';
  }
  if (!state.connected || (state.fromCache && !state.lastSync)) return 'Connexion…';
  if (state.fromCache) return state.pending ? 'Hors ligne, envoi en attente' : 'Hors ligne';
  return 'Synchronisé';
}

// ---------------------------------------------------------------------------
// Configuration Firebase
// ---------------------------------------------------------------------------

const CONFIG_KEYS = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];

export function firebaseConfig() {
  const fromFile = window.FIREBASE_CONFIG;
  if (fromFile?.apiKey && fromFile?.projectId && fromFile?.appId) return fromFile;
  return state.settings.firebaseConfig;
}

/** Accepte le bloc « const firebaseConfig = { … } » copié depuis la console, ou du JSON. */
export function parseFirebaseConfig(text) {
  const config = {};
  for (const key of CONFIG_KEYS) {
    const match = new RegExp(`["']?${key}["']?\\s*:\\s*["']([^"']+)["']`).exec(text ?? '');
    if (match) config[key] = match[1].trim();
  }
  return config.apiKey && config.projectId && config.appId ? config : null;
}

// Invitation = code du foyer + configuration Firebase, pour le second iPhone.
const INVITE_PREFIX = 'FRIGO1.';

export function invitationCode() {
  const payload = JSON.stringify({ h: state.settings.householdCode, c: firebaseConfig() });
  const base64 = btoa(unescape(encodeURIComponent(payload)));
  return INVITE_PREFIX + base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function parseInvitation(text) {
  const match = /FRIGO1\.([A-Za-z0-9_-]+)/.exec(text ?? '');
  if (!match) return null;
  try {
    let base64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    const payload = JSON.parse(decodeURIComponent(escape(atob(base64))));
    const code = normalizeHouseholdCode(payload.h);
    if (!code || !payload.c?.apiKey || !payload.c?.projectId) return null;
    return { code, config: payload.c };
  } catch {
    return null;
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateHouseholdCode() {
  const values = crypto.getRandomValues(new Uint32Array(10));
  const chars = [...values].map((v) => CODE_ALPHABET[v % CODE_ALPHABET.length]).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

export function normalizeHouseholdCode(input) {
  const cleaned = String(input ?? '').toUpperCase().split('').filter((c) => CODE_ALPHABET.includes(c)).join('');
  return cleaned.length === 10 ? `${cleaned.slice(0, 5)}-${cleaned.slice(5)}` : null;
}

// ---------------------------------------------------------------------------
// Démarrage Firebase et écoute en temps réel
// ---------------------------------------------------------------------------

let app = null;
let auth = null;
let db = null;
let unsubscribers = [];
const meta = {};

function ensureFirebase() {
  if (db) return true;
  const config = firebaseConfig();
  if (!config) return false;
  app = initializeApp(config);
  auth = getAuth(app);
  try {
    db = initializeFirestore(app, { localCache: persistentLocalCache(), ignoreUndefinedProperties: true });
  } catch {
    db = initializeFirestore(app, { localCache: memoryLocalCache(), ignoreUndefinedProperties: true });
  }
  return true;
}

async function signIn() {
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
}

export async function start() {
  const code = state.settings.householdCode;
  if (!code || unsubscribers.length || !ensureFirebase()) return;
  try {
    await signIn();
  } catch (error) {
    state.error = errorMessage(error);
    emit('sync');
    return;
  }
  if (unsubscribers.length) return;
  const listen = (name, key, map) => onSnapshot(
    collection(db, 'foyers', code, name),
    { includeMetadataChanges: true },
    (snapshot) => {
      state[key] = snapshot.docs.map((d) => map(d.id, d.data()));
      meta[key] = { fromCache: snapshot.metadata.fromCache, pending: snapshot.metadata.hasPendingWrites };
      const metas = Object.values(meta);
      state.fromCache = metas.some((m) => m.fromCache);
      state.pending = metas.some((m) => m.pending);
      if (!snapshot.metadata.fromCache) {
        state.error = null;
        state.lastSync = new Date();
      }
      emit(key);
    },
    (error) => {
      state.error = errorMessage(error);
      stop();
      emit('sync');
    }
  );
  unsubscribers = [
    listen('produits', 'products', toProduct),
    listen('courses', 'shopping', toShoppingItem),
    listen('recettes', 'recipes', toRecipe)
  ];
  state.connected = true;
  emit('sync');
}

function stop() {
  unsubscribers.forEach((u) => u());
  unsubscribers = [];
  state.connected = false;
}

/** Retour au premier plan : se rebranche si une erreur avait coupé l'écoute. */
export async function resume() {
  if (!state.connected) await start();
}

/** Bouton « Se reconnecter » des Réglages. */
export async function reconnect() {
  stop();
  state.error = null;
  emit('sync');
  await start();
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
  ]);
}

// ---------------------------------------------------------------------------
// Foyer partagé
// ---------------------------------------------------------------------------

export async function createHousehold() {
  if (!ensureFirebase()) throw new Error('Configuration Firebase manquante.');
  await withTimeout(signIn(), 20_000, 'Connexion à Firebase impossible : vérifiez la connexion internet.');
  const code = generateHouseholdCode();
  await withTimeout(
    setDoc(doc(db, 'foyers', code), { createdAt: serverTimestamp(), createdBy: state.settings.userName }),
    20_000, 'Firebase ne répond pas : vérifiez la connexion internet.'
  );
  setHousehold(code);
  return code;
}

/** Accepte un code (« K7M2Q-XP9RT ») ou une invitation complète (« FRIGO1.… »). */
export async function joinHousehold(input) {
  const invitation = parseInvitation(input);
  if (invitation && !window.FIREBASE_CONFIG?.apiKey) {
    updateSettings({ firebaseConfig: invitation.config });
  }
  const code = invitation?.code ?? normalizeHouseholdCode(input);
  if (!code) throw new Error('Code invalide : collez le code d\'invitation reçu (il commence par FRIGO1.).');
  if (!ensureFirebase()) throw new Error("Configuration Firebase manquante : collez le code d'invitation complet.");
  await withTimeout(signIn(), 20_000, 'Connexion à Firebase impossible : vérifiez la connexion internet.');
  const snapshot = await withTimeout(getDoc(doc(db, 'foyers', code)), 20_000,
    'Firebase ne répond pas : vérifiez la connexion internet.');
  if (!snapshot.exists()) throw new Error("Aucun foyer ne correspond à ce code. Vérifiez-le sur l'autre iPhone (Réglages > Foyer partagé).");
  setHousehold(code);
}

function setHousehold(code) {
  stop();
  state.products = [];
  state.shopping = [];
  state.recipes = [];
  state.error = null;
  updateSettings({ householdCode: code });
  start();
}

export function leaveHousehold() {
  stop();
  state.products = [];
  state.shopping = [];
  state.recipes = [];
  updateSettings({ householdCode: '', onboardingDone: false });
}

// ---------------------------------------------------------------------------
// Conversion des documents
// ---------------------------------------------------------------------------

function toProduct(id, d) {
  return {
    id,
    name: d.name ?? '',
    expiry: d.expiry ?? '',
    category: d.category ?? 'autre',
    quantity: d.quantity ?? '',
    barcode: d.barcode ?? '',
    addedBy: d.addedBy ?? '',
    createdAt: d.createdAt ?? 0,
    image: d.image ?? '',
    imageUrl: d.imageUrl ?? ''
  };
}

function toShoppingItem(id, d) {
  return {
    id,
    name: d.name ?? '',
    quantity: d.quantity ?? '',
    checked: Boolean(d.checked),
    addedBy: d.addedBy ?? '',
    createdAt: d.createdAt ?? 0
  };
}

function toRecipe(id, d) {
  return { ...d, id, ingredients: d.ingredients ?? [], steps: d.steps ?? [], usedProductIds: d.usedProductIds ?? [] };
}

// ---------------------------------------------------------------------------
// Écritures (Firestore les garde en file d'attente si l'iPhone est hors ligne)
// ---------------------------------------------------------------------------

function ref(name, id) {
  return doc(db, 'foyers', state.settings.householdCode, name, id);
}

function canWrite() {
  return Boolean(db && state.settings.householdCode);
}

function reportWriteError(error) {
  state.error = errorMessage(error);
  emit('sync');
}

function write(promise) {
  promise.catch(reportWriteError);
}

export function saveProduct(product) {
  if (!canWrite()) return;
  write(setDoc(ref('produits', product.id), {
    name: (product.name ?? '').trim(),
    expiry: product.expiry,
    category: product.category || 'autre',
    quantity: (product.quantity ?? '').trim(),
    barcode: product.barcode || '',
    addedBy: product.addedBy || state.settings.userName,
    createdAt: product.createdAt || Date.now(),
    image: product.image || '',
    imageUrl: product.imageUrl || ''
  }));
}

/** Retire des produits (consommés ou jetés). Renvoie les produits retirés, pour « Annuler ». */
export function removeProducts(ids) {
  if (!canWrite()) return [];
  const removed = state.products.filter((p) => ids.includes(p.id));
  if (!removed.length) return [];
  const batch = writeBatch(db);
  removed.forEach((p) => batch.delete(ref('produits', p.id)));
  write(batch.commit());
  return removed;
}

export function restoreProducts(products) {
  products.forEach((p) => saveProduct(p));
}

export function addShoppingItem(name, quantity = '') {
  const trimmed = (name ?? '').trim();
  if (!trimmed || !canWrite()) return false;
  const exists = state.shopping.some((i) => !i.checked
    && i.name.localeCompare(trimmed, 'fr', { sensitivity: 'base' }) === 0);
  if (exists) return false;
  const id = crypto.randomUUID();
  write(setDoc(ref('courses', id), {
    name: trimmed, quantity, checked: false, addedBy: state.settings.userName, createdAt: Date.now()
  }));
  return true;
}

export function toggleShoppingItem(id) {
  const item = state.shopping.find((i) => i.id === id);
  if (!item || !canWrite()) return;
  write(setDoc(ref('courses', id), { checked: !item.checked }, { merge: true }));
}

export function deleteShoppingItems(ids) {
  if (!canWrite() || !ids.length) return;
  const batch = writeBatch(db);
  ids.forEach((id) => batch.delete(ref('courses', id)));
  write(batch.commit());
}

export function clearCheckedShopping() {
  deleteShoppingItems(state.shopping.filter((i) => i.checked).map((i) => i.id));
}

/** Ajoute les ingrédients « à acheter » d'une recette. Renvoie le nombre ajouté. */
export function addMissingIngredients(recipe) {
  return recipe.ingredients
    .filter((i) => i.source === 'a_acheter')
    .reduce((count, i) => count + (addShoppingItem(i.name, i.quantity) ? 1 : 0), 0);
}

export function saveRecipes(recipes) {
  if (!canWrite() || !recipes.length) return;
  const batch = writeBatch(db);
  recipes.forEach(({ id, ...data }) => batch.set(ref('recettes', id), data));
  // Garde les favoris + les 40 recettes les plus récentes.
  const all = [...recipes, ...state.recipes.filter((r) => !recipes.some((n) => n.id === r.id))];
  all.filter((r) => !r.favorite)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(40)
    .forEach((r) => batch.delete(ref('recettes', r.id)));
  write(batch.commit());
}

export function toggleFavorite(id) {
  const recipe = state.recipes.find((r) => r.id === id);
  if (!recipe || !canWrite()) return;
  write(setDoc(ref('recettes', id), { favorite: !recipe.favorite }, { merge: true }));
}

export function deleteRecipe(id) {
  if (!canWrite()) return;
  write(deleteDoc(ref('recettes', id)));
}

// ---------------------------------------------------------------------------
// Messages d'erreur compréhensibles
// ---------------------------------------------------------------------------

export function errorMessage(error) {
  const code = error?.code ?? '';
  switch (code) {
    case 'permission-denied':
      return 'Accès refusé par Firebase : vérifiez les règles Firestore (README, étape 1).';
    case 'unavailable':
      return 'Pas de connexion : les modifications seront envoyées au retour du réseau.';
    case 'not-found':
    case 'failed-precondition':
      return 'Base Firestore introuvable : créez-la dans la console Firebase (README, étape 1).';
    case 'auth/operation-not-allowed':
    case 'auth/admin-restricted-operation':
      return 'Activez la connexion « Anonyme » dans Firebase > Authentication (README, étape 1).';
    case 'auth/configuration-not-found':
      return 'Authentication n\'est pas activé dans la console Firebase (README, étape 1).';
    case 'auth/api-key-not-valid':
    case 'auth/invalid-api-key':
      return 'Configuration Firebase invalide : recopiez-la depuis la console Firebase.';
    case 'auth/network-request-failed':
      return 'Pas de connexion internet.';
    default:
      return error?.message ?? String(error);
  }
}

// Utilisé par l'interface pour la pastille de l'icône.
export function badgeCount() {
  return state.products.filter((p) => daysUntil(p.expiry) <= state.settings.alertDays).length;
}
