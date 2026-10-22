"use strict";
const express = require("express");
const db = require("../src/db");
const mail = require("../src/mail");
const instagram = require("../src/instagram");
const payments = require("../src/payments");
const moloni = require("../src/moloni");

const router = express.Router();

const AVAILABLE = "status = 'available' AND stock > 0";
const fmt = (cents) => (cents / 100).toFixed(2).replace(".", ",") + "€";

function eventPast(ev) {
  return new Date(ev.ends_at || ev.starts_at) < new Date();
}

function wordcloud() {
  return db.db
    .prepare(`SELECT category AS cat, COUNT(*) AS c FROM books WHERE ${AVAILABLE} AND category <> '' GROUP BY category ORDER BY c DESC, cat ASC LIMIT 14`)
    .all();
}

async function renderHome(req, res) {
  const ig = await instagram.getFeed();
  // em linha: as últimas 6 publicações (imagens); manuais com imagem sempre que falem falta
  let posts = ig.posts.map((p) => ({ image_url: p.image, caption: p.caption, url: p.permalink }));
  if (posts.length < 6) {
    const manual = db.db
      .prepare("SELECT image_url, caption, ig_shortcode FROM news WHERE kind = 'manual' AND published = 1 AND image_url <> '' ORDER BY id DESC LIMIT 6")
      .all()
      .map((n) => ({ image_url: n.image_url, caption: n.caption, ig_shortcode: n.ig_shortcode }));
    posts = [...posts, ...manual].slice(0, 6);
  }

  const upcoming = db.db
    .prepare("SELECT * FROM events WHERE published = 1 ORDER BY starts_at ASC")
    .all()
    .filter((e) => !eventPast(e))
    .slice(0, 4);

  res.render("home", {
    cats: wordcloud(),
    posts,
    igConfigured: ig.configured,
    upcoming,
    maxCatCount: Math.max(1, ...wordcloud().map((w) => w.c)),
    settings: allSettings(),
    fmt,
  });
}

function allSettings() {
  const rows = db.db.prepare("SELECT k, v FROM settings").all();
  return Object.fromEntries(rows.map((r) => [r.k, r.v]));
}

function searchBooks(q) {
  const like = "%" + q.replace(/[%_]/g, "") + "%";
  return db.db
    .prepare(
      `SELECT id, title, author, publisher, isbn, category, price_cents, stock, cover_url, description
       FROM books WHERE ${AVAILABLE} AND (title LIKE ? OR author LIKE ? OR publisher LIKE ? OR isbn LIKE ? OR category LIKE ?)
       ORDER BY (author LIKE ?) + (title LIKE ?) DESC, title ASC LIMIT 60`
    )
    .all(like, like, like, like, like, like, like);
}

router.get("/", (req, res) => renderHome(req, res));

router.get("/chat", (req, res) => {
  res.render("chat", { settings: allSettings() });
});

router.get("/livestream", (req, res) => {
  res.render("livestream", { settings: allSettings(), stream_info: (req.query.info || "").slice(0, 200) });
});

const PER_PAGE = 12;

router.get("/pesquisa", (req, res) => {
  const q = (req.query.q || "").trim();
  const cat = (req.query.cat || "").trim();
  const page = Math.max(1, Math.floor(Number(req.query.page) || 1));

  let where = AVAILABLE;
  const args = [];
  if (cat) { where += " AND category = ?"; args.push(cat); }
  if (q) {
    const like = "%" + q.replace(/[%_]/g, "") + "%";
    where += " AND (title LIKE ? OR author LIKE ? OR publisher LIKE ? OR isbn LIKE ? OR category LIKE ?)";
    args.push(like, like, like, like, like);
  }

  const countRow = db.db.prepare(`SELECT COUNT(*) AS c FROM books WHERE ${where}`).get(...args);
  const total = countRow.c;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const cur = Math.min(page, pages);
  const books = db.db
    .prepare(
      `SELECT id, title, author, publisher, isbn, category, price_cents, stock, cover_url, description
       FROM books WHERE ${where} ORDER BY title COLLATE NOCASE ASC LIMIT ? OFFSET ?`
    )
    .all(...args, PER_PAGE, (cur - 1) * PER_PAGE);

  res.render("search", { q, cat, books, fmt, total, page: cur, pages, cats: wordcloud(), maxCatCount: Math.max(1, ...wordcloud().map((w) => w.c)) });
});

router.get("/livro/:id", (req, res, next) => {
  const book = db.db
    .prepare(`SELECT * FROM books WHERE id = ? AND status = 'available'`)
    .get(Number(req.params.id));
  if (!book) return next();
  if (book.stock <= 0) return next();
  res.render("book", { book, fmt });
});

router.get("/api/livro/:id", (req, res, next) => {
  const book = db.db
    .prepare(`SELECT id, title, author, publisher, isbn, category, price_cents, stock, cover_url, description FROM books WHERE id = ? AND status = 'available'`)
    .get(Number(req.params.id));
  if (!book || book.stock <= 0) return next();
  res.json({ livro: book });
});

router.get("/surpresa", (req, res) => {
  // sorte única: manda directo à ficha de um livro em prateleira
  const rows = db.db.prepare(`SELECT id FROM books WHERE ${AVAILABLE}`).all();
  if (!rows.length) return res.redirect("/pesquisa");
  res.redirect("/livro/" + rows[Math.floor(Math.random() * rows.length)].id);
});

/* ---------- Carrinho / Checkout ---------- */

router.get("/carrinho", (req, res) => {
  res.render("cart", { settings: allSettings() });
});

router.post("/api/orders", express.json(), async (req, res) => {
  const { items, name, email, phone, vat, delivery, address, postal, city, note, payment } = req.body || {};
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "carrinho vazio" });
  if (!name || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "nome e email válidos obrigatórios" });
  if (delivery === "ship" && (!address || !postal || !city)) return res.status(400).json({ error: "endereço completo obrigatório para envio" });
  if (!["stripe", "transfer", "store"].includes(payment)) return res.status(400).json({ error: "método de pagamento inválido" });
  if (payment === "store" && delivery !== "pickup") return res.status(400).json({ error: "pagamento na loja é só para recolha na loja" });
  if (payment !== "store" && delivery === "ship" && !payments.isConfigured() && !(db.getSetting("iban") || db.getSetting("mbway")))
    return res.status(400).json({ error: "pagamento online ainda não configurado" });

  const out = [];
  for (const it of items) {
    const qty = Math.max(1, Math.min(9, Number(it.qty) || 1));
    const book = db.db.prepare("SELECT * FROM books WHERE id = ? AND status = 'available'").get(Number(it.id));
    if (!book) return res.status(409).json({ error: "livro indisponível (id " + it.id + ")" });
    if (book.stock < qty) return res.status(409).json({ error: `apenas ${book.stock} unidade(s) de "${book.title}"` });
    out.push({ id: book.id, title: book.title, qty, unit_price_cents: book.price_cents });
  }

  const FREE = Number(db.getSetting("free_shipping_cents") || 0);
  const SHIP = Number(db.getSetting("shipping_cents") || 0);
  const subtotal = out.reduce((s, i) => s + i.unit_price_cents * i.qty, 0);
  let shippingCents = delivery === "ship" && subtotal < FREE ? SHIP : 0;
  if (delivery === "pickup" || payment === "store") shippingCents = 0;

  const code = db.genOrderCode();
  const tx = db.db;
  tx.prepare(
    `INSERT INTO orders (code, name, email, phone, vat, delivery, address, postal, city, note, shipping_cents, total_cents, payment_method, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(code, name, email, phone || "", vat || "", delivery, address || "", postal || "", city || "", note || "",
    shippingCents, subtotal + shippingCents, payment, db.now(), db.now());
  const order = tx.prepare("SELECT * FROM orders WHERE code = ?").get(code);
  const add = tx.prepare("INSERT INTO order_items (order_id, book_id, title, qty, unit_price_cents) VALUES (?, ?, ?, ?, ?)");
  for (const it of out) {
    add.run(order.id, it.id, it.title, it.qty, it.unit_price_cents);
    tx.prepare("UPDATE books SET stock = stock - ? WHERE id = ?").run(it.qty, it.id);
  }

  // Stripe checkout quando aplicável
  let payUrl = null;
  if (payment === "stripe" && payments.isConfigured()) {
    try {
      const orderWithShipping = { ...order, shipping_cents: shippingCents };
      const session = await payments.createCheckout(orderWithShipping, out);
      if (session) {
        payUrl = session.url;
        tx.prepare("UPDATE orders SET stripe_session_id = ? WHERE id = ?").run(session.id, order.id);
      }
    } catch (err) {
      console.error("[stripe]", err.message);
    }
  }

  mail.orderPlaced(order, out);
  pushChatSystem(`>> nova encomenda ${code} - boa sorte no embrulho!`);

  res.json({ code, url: "/encomenda/" + code, payUrl });
});

router.get("/encomenda/:code", async (req, res, next) => {
  const order = db.db.prepare("SELECT * FROM orders WHERE code = ?").get(req.params.code);
  if (!order) return next();
  if (req.query.pago) await payments.confirmSession(order);
  const items = db.db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(order.id);
  if (order.payment_status === "pending" && order.payment_method === "stripe" && payments.isConfigured()) {
    try {
      const session = await payments.getStripe().checkout.sessions.retrieve(order.stripe_session_id);
      if (session.url && session.payment_status !== "paid") {
        // sessão ainda viva — reutilizar URL
        res.locals.payUrl = session.url;
      } else if (session.payment_status === "paid") {
        await payments.confirmSession(order);
      } else {
        // sessão expirada → criar nova
        const fresh = await payments.createCheckout(
          { ...order, shipping_cents: order.shipping_cents },
          items.map((i) => ({ title: i.title, qty: i.qty, unit_price_cents: i.unit_price_cents }))
        );
        if (fresh) {
          db.db.prepare("UPDATE orders SET stripe_session_id = ? WHERE id = ?").run(fresh.id, order.id);
          res.locals.payUrl = fresh.url;
        }
      }
    } catch (err) {
      console.error("[stripe]", err.message);
      try {
        await payments.confirmSession(order);
      } catch { /* ignore */ }
    }
  }
  res.render("order", { order, items, fmt, payUrl: res.locals.payUrl || null, settings: allSettings() });
});

/* ---------- Agenda / Arquivo (uma página, dois tempos) ---------- */
router.get("/agenda", (req, res) => {
  const all = db.db.prepare("SELECT * FROM events WHERE published = 1 ORDER BY starts_at ASC").all();
  res.render("agenda", {
    upcoming: all.filter((e) => !eventPast(e)),
    past: all.filter((e) => eventPast(e)).reverse(),
    fmt,
  });
});
router.get("/arquivo", (req, res) => { res.redirect("/agenda#arquivo"); });

router.get("/evento/:id", (req, res, next) => {
  const ev = db.db.prepare("SELECT * FROM events WHERE id = ? AND published = 1").get(Number(req.params.id));
  if (!ev) return next();
  res.render("event", { ev, fmt });
});

/* ---------- Chat retro ---------- */

// Mensagens de sistema no chat (ex.: encomendas) — cross-module
let chatSystemFn = (msg) => {
  db.db.prepare("INSERT INTO messages (nick, body, created_at) VALUES (?, ?, ?)").run("trama", msg, db.now());
};
function pushChatSystem(msg) { try { chatSystemFn(msg); } catch { /* inofensivo */ } }

module.exports = { router, pushChatSystem, allSettings, searchBooks, eventPast };
