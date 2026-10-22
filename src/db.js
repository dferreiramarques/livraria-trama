"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = process.env.TRAMA_DATA_DIR || path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "trama.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  pw_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT DEFAULT '',
  publisher TEXT DEFAULT '',
  isbn TEXT DEFAULT '',
  category TEXT DEFAULT '',
  price_cents INTEGER NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'available', -- available | sold
  description TEXT DEFAULT '',
  cover_url TEXT DEFAULT '',
  featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'evento',  -- evento | exposicao
  starts_at TEXT NOT NULL,
  ends_at TEXT DEFAULT '',
  description TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'manual',  -- manual | instagram
  ig_shortcode TEXT DEFAULT '',
  caption TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT DEFAULT '',
  vat TEXT DEFAULT '',
  delivery TEXT NOT NULL DEFAULT 'pickup', -- pickup | ship
  address TEXT DEFAULT '',
  postal TEXT DEFAULT '',
  city TEXT DEFAULT '',
  note TEXT DEFAULT '',
  internal_note TEXT DEFAULT '',
  shipping_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'store', -- stripe | transfer | store
  payment_status TEXT NOT NULL DEFAULT 'pending', -- pending | paid | canceled
  status TEXT NOT NULL DEFAULT 'new',   -- new | confirmed | shipped | ready | done | canceled
  stripe_session_id TEXT DEFAULT '',
  moloni_status TEXT DEFAULT '',        -- '' | pending | invoiced | error
  moloni_doc_id TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  book_id INTEGER REFERENCES books(id),
  title TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nick TEXT NOT NULL,
  body TEXT NOT NULL,
  ip_hash TEXT DEFAULT '',
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT
);
`);

function now() {
  return new Date().toISOString();
}

function getSetting(k, fallback = "") {
  const row = db.prepare("SELECT v FROM settings WHERE k = ?").get(k);
  return row ? row.v : fallback;
}

function setSetting(k, v) {
  db.prepare(
    "INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v"
  ).run(k, v == null ? "" : String(v));
}

const DEFAULT_SETTINGS = {
  store_name: "Livraria Trama",
  store_address: "Rua dos Bragas, 32, 4050-122 Porto",
  store_hours: "Terça a Sexta · 11h00–14h00 / 14h30–18h00 · Sábado · 12h00–14h00 / 14h30–18h00",
  store_email: "livrariatrama@gmail.com",
  store_phone: "",
  ig_handle: "livrariatrama",
  shipping_cents: "350",
  free_shipping_cents: "4500",
  iban: "",
  mbway: "",
  chat_welcome: "Bem-vindo ao canal #trama. Falemos de livros, arte e outras tramas.",
};

for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
  if (getSetting(k, "") === "") setSetting(k, v);
}

function genOrderCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = "T-" + Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
  } while (db.prepare("SELECT 1 FROM orders WHERE code = ?").get(code));
  return code;
}

module.exports = { db, now, getSetting, setSetting, genOrderCode };
