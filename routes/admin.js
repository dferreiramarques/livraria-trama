"use strict";
const express = require("express");
const db = require("../src/db");
const mail = require("../src/mail");
const instagram = require("../src/instagram");
const payments = require("../src/payments");
const moloni = require("../src/moloni");
const { requireAdmin } = require("../src/auth");

const router = express.Router();
const now = () => db.now();
const fmt = (c) => (c / 100).toFixed(2).replace(".", ",") + "€";

function allSettings() {
  return Object.fromEntries(db.db.prepare("SELECT k, v FROM settings").all().map((r) => [r.k, r.v]));
}

router.use("/login", (req, res, next) => next());

router.get("/login", (req, res) => {
  if (req.session.userId) return res.redirect("/admin");
  res.render("admin/login", { error: null, next: req.query.next || "" });
});

router.post("/login", express.urlencoded({ extended: false }), (req, res) => {
  const { verifyUser } = require("../src/auth");
  const user = verifyUser(String(req.body.username || ""), String(req.body.password || ""));
  if (!user) {
    setTimeout(() => res.status(401).render("admin/login", { error: "credenciais erradas", next: req.body.next || "" }), 400);
    return;
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  res.redirect(String(req.body.next || "/admin"));
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/admin/login"));
});

router.use(requireAdmin);

router.get("/", (req, res) => {
  const orders = db.db
    .prepare(`SELECT o.*, (SELECT SUM(qty) FROM order_items oi WHERE oi.order_id = o.id) AS qty_items
              FROM orders o ORDER BY o.id DESC LIMIT 100`).all();
  const stats = db.db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM orders WHERE updated_at > date('now','-30 days') AND payment_status = 'paid') AS paid30,
       (SELECT COALESCE(SUM(total_cents),0) FROM orders WHERE updated_at > date('now','-30 days') AND payment_status = 'paid') AS euros30,
       (SELECT COUNT(*) FROM orders WHERE status IN ('new','confirmed')) AS pending,
       (SELECT COUNT(*) FROM orders WHERE status IN ('new','confirmed') AND delivery = 'pickup') AS pickups
    `).get();
  const lowStock = db.db.prepare(`SELECT title, stock FROM books WHERE status = 'available' AND stock <= 2 ORDER BY stock ASC LIMIT 8`).all();
  res.render("admin/dashboard", { orders, stats, fmt, lowStock, tab: "inicio", settings: allSettings(), username: req.session.username });
});

/* ---------- Encomendas ---------- */
router.get("/encomendas", (req, res) => {
  const filter = req.query.f || "";
  let sql = "SELECT o.*, (SELECT SUM(qty) FROM order_items oi WHERE oi.order_id = o.id) AS qty_items FROM orders o";
  let args = [];
  if (filter === "pendentes") { sql += " WHERE status IN ('new','confirmed')"; }
  if (filter === "pago") { sql += " WHERE payment_status = 'paid' AND status IN ('new','confirmed')"; }
  sql += " ORDER BY o.id DESC LIMIT 200";
  const orders = db.db.prepare(sql).all(...args);
  res.render("admin/orders", { orders, filter, fmt, tab: "encomendas", settings: allSettings(), username: req.session.username });
});

router.get("/encomendas/:id", (req, res, next) => {
  const order = db.db.prepare("SELECT * FROM orders WHERE id = ?").get(Number(req.params.id));
  if (!order) return next();
  const items = db.db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(order.id);
  res.render("admin/order_detail", { order, items, fmt, tab: "encomendas", settings: allSettings(), username: req.session.username });
});

const actionsEmail = { shipped: mail.orderShipped, ready: mail.orderReady };

router.post("/encomendas/:id/acao", express.urlencoded({ extended: false }), async (req, res) => {
  const order = db.db.prepare("SELECT * FROM orders WHERE id = ?").get(Number(req.params.id));
  if (!order) return res.status(404).send("não encontrado");
  const action = req.body.action;

  if (action === "pago") {
    db.db.prepare(`UPDATE orders SET payment_status = 'paid', status = CASE WHEN status='new' THEN 'confirmed' ELSE status END, updated_at = ? WHERE id = ?`).run(now(), order.id);
    await moloni.createInvoiceForOrder(order,
      db.db.prepare("SELECT title, qty, unit_price_cents FROM order_items WHERE order_id = ?").all(order.id));
  }
  if (action === "cancel") {
    db.db.prepare(`UPDATE orders SET payment_status = 'canceled', status = 'canceled', updated_at = ? WHERE id = ?`).run(now(), order.id);
    const items = db.db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(order.id);
    for (const it of items) {
      if (it.book_id) db.db.prepare("UPDATE books SET stock = stock + ? WHERE id = ?").run(it.qty, it.book_id);
    }
    mail.orderCanceled(order);
  }
  if (action === "confirm") {
    db.db.prepare(`UPDATE orders SET status = CASE WHEN status='new' THEN 'confirmed' ELSE status END, updated_at = ? WHERE id = ?`).run(now(), order.id);
  }
  if (action === "shipped" || action === "ready") {
    db.db.prepare(`UPDATE orders SET status = CASE WHEN status IN ('new','confirmed') THEN ? ELSE status END, updated_at = ? WHERE id = ?`)
      .run(action, now(), order.id);
    actionsEmail[action](order);
  }
  if (action === "done") {
    db.db.prepare(`UPDATE orders SET status = 'done', updated_at = ? WHERE id = ?`).run(now(), order.id);
  }
  if (action === "note") {
    db.db.prepare("UPDATE orders SET internal_note = ?, updated_at = ? WHERE id = ?").run(String(req.body.note || ""), now(), order.id);
  }
  if (action === "invoice") {
    await moloni.createInvoiceForOrder(order,
      db.db.prepare("SELECT title, qty, unit_price_cents FROM order_items WHERE order_id = ?").all(order.id));
  }
  res.redirect(req.body.back || `/admin/encomendas/${order.id}`);
});

/* ---------- Livros ---------- */
const googleBooks = require("../src/googleBooks");

// adicionar on-click por ISBN: vai ao Google Books, cria a ficha e manda para edição
router.post("/livros/isbn", express.urlencoded({ extended: false }), async (req, res) => {
  const isbn = String(req.body.isbn || "").trim();
  if (!isbn) return res.redirect("/admin/livros?erro=vazio");
  try {
    const data = await googleBooks.lookupByIsbn(isbn);
    if (!data) return res.redirect("/admin/livros?erro=sem-dados");
    const dup = db.db.prepare("SELECT id FROM books WHERE isbn = ?").get(data.isbn);
    if (dup) return res.redirect(`/admin/livros/${Number(dup.id)}/editar?duplicado=1`);
    const r = db.db.prepare(
      `INSERT INTO books (title, author, publisher, isbn, category, price_cents, stock, status, description, cover_url, featured, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 1, 'available', ?, ?, 0, ?, ?)`
    ).run(data.title || "(sem título)", data.author, data.publisher, data.isbn, data.category, data.description, data.cover_url, db.now(), db.now());
    return res.redirect(`/admin/livros/${Number(r.lastInsertRowid)}/editar?do-google=1`);
  } catch (err) {
    console.error("[google-books]", err.message);
    return res.redirect("/admin/livros?erro=" + encodeURIComponent(err.message.slice(0, 60)));
  }
});

// preencher a ficha na edição (JSON p/ javascript)
router.get("/engine/google", (req, res) => {
  require("../src/googleBooks").lookupByIsbn(String(req.query.isbn || ""))
    .then((data) => res.json({ livro: data }))
    .catch((err) => res.status(502).json({ error: err.message }));
});

router.get("/livros", (req, res) => {
  const q = (req.query.q || "").trim();
  const f = req.query.f || "em"; // em | np | sold | all
  let sql = "SELECT * FROM books";
  const wh = [], args = [];
  if (q) { wh.push("(title LIKE ? OR author LIKE ? OR isbn LIKE ?)"); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (f === "em") wh.push("status = 'available'");
  if (f === "np") wh.push("status = 'unpublished'");
  if (f === "sold") wh.push("status = 'sold'");
  // f=all → sem filtro
  if (wh.length) sql += " WHERE " + wh.join(" AND ");
  sql += " ORDER BY updated_at DESC LIMIT 400";
  const books = db.db.prepare(sql).all(...args);
  const erro = req.query.erro || "";
  res.render("admin/books", { books, q, f, erro, fmt, tab: "livros", settings: allSettings(), username: req.session.username });
});

router.get("/livros/novo", (req, res) => {
  res.render("admin/book_form", { book: null, tab: "livros", settings: allSettings(), username: req.session.username });
});

router.get("/livros/:id/editar", (req, res, next) => {
  const book = db.db.prepare("SELECT * FROM books WHERE id = ?").get(Number(req.params.id));
  if (!book) return next();
  res.render("admin/book_form", { book, tab: "livros", settings: allSettings(), username: req.session.username });
});

router.post("/livros/save", express.urlencoded({ extended: false }), (req, res) => {
  const b = req.body;
  const id = Number(b.id) || null;
  const fields = {
    title: String(b.title || "").trim(),
    author: String(b.author || "").trim(),
    publisher: String(b.publisher || "").trim(),
    isbn: String(b.isbn || "").trim(),
    category: String(b.category || "").trim(),
    price_cents: Math.max(0, Math.round(Number(String(b.price).replace(",", ".")) * 100) || 0),
    stock: Math.max(0, Number(b.stock) || 0),
    status: ["available", "unpublished", "sold"].includes(b.status) ? b.status : "available",
    description: String(b.description || "").trim(),
    cover_url: String(b.cover_url || "").trim(),
    featured: b.featured ? 1 : 0,
    updated_at: now(),
  };
  if (!fields.title) return res.status(400).send("título obrigatório");
  if (id) {
    const cur = db.db.prepare("SELECT status, stock FROM books WHERE id = ?").get(id);
    // volta de não-publicado/vendido → repristinado como em prateleira se marcado disponível
    if (cur && cur.status !== "available" && fields.status === "available" && cur.stock === 0 && fields.stock === 0) {
      fields.stock = 1;
    }
    db.db.prepare(`UPDATE books SET title=@title, author=@author, publisher=@publisher, isbn=@isbn, category=@category,
      price_cents=@price_cents, stock=@stock, status=@status, description=@description, cover_url=@cover_url,
      featured=@featured, updated_at=@updated_at WHERE id=@id`).run({ ...fields, id });
  } else {
    const r = db.db.prepare(`INSERT INTO books (title, author, publisher, isbn, category, price_cents, stock, status, description, cover_url, featured, created_at, updated_at)
      VALUES (@title, @author, @publisher, @isbn, @category, @price_cents, @stock, @status, @description, @cover_url, @featured, @updated_at, @updated_at)`).run(fields);
    return res.redirect(`/admin/livros/${Number(r.lastInsertRowid)}/editar`);
  }
  res.redirect("/admin/livros");
});

router.post("/livros/:id/acao", express.urlencoded({ extended: false }), (req, res) => {
  const id = Number(req.params.id);
  const book = db.db.prepare("SELECT * FROM books WHERE id = ?").get(id);
  if (!book) return res.status(404).send("não encontrado");
  switch (req.body.action) {
    case "sair": // sai do catálogo público → guarda como não-publicado (nada é apagado)
      db.db.prepare("UPDATE books SET status = 'unpublished', updated_at = ? WHERE id = ?").run(now(), id);
      break;
    case "vender": // marcado vendido: também sai do público, com memória de venda
      db.db.prepare("UPDATE books SET status = 'sold', stock = 0, updated_at = ? WHERE id = ?").run(now(), id);
      break;
    case "restaurar": // volta ao público; se tinha stock 0, garante uma unidade visível
      db.db.prepare("UPDATE books SET status = 'available', stock = CASE WHEN stock = 0 THEN 1 ELSE stock END, updated_at = ? WHERE id = ?").run(now(), id);
      break;
    case "stock":
      db.db.prepare("UPDATE books SET stock = MAX(0, stock + ?), updated_at = ? WHERE id = ?")
        .run(Number(req.body.delta) || 0, now(), id);
      break;
    case "apagar":
      try {
        db.db.prepare("DELETE FROM books WHERE id = ?").run(id);
      } catch {
        db.db.prepare("UPDATE books SET status = 'unpublished', updated_at = ? WHERE id = ?").run(now(), id);
      }
      break;
  }
  res.redirect(req.body.back || "/admin/livros");
});

/* ---------- Eventos / Exposições ---------- */
router.get("/eventos", (req, res) => {
  const events = db.db.prepare("SELECT * FROM events ORDER BY starts_at DESC LIMIT 200").all();
  res.render("admin/events", { events, fmt: null, tab: "eventos", settings: allSettings(), username: req.session.username });
});

router.post("/eventos/save", express.urlencoded({ extended: false }), (req, res) => {
  const b = req.body;
  const id = Number(b.id) || null;
  const starts = String(b.starts_at || "").replace("T", "T").slice(0, 16) || new Date().toISOString().slice(0, 16);
  if (id) {
    db.db.prepare(`UPDATE events SET title=?, kind=?, starts_at=?, ends_at=?, description=?, image_url=?, published=? WHERE id=?`)
      .run(String(b.title || "—"), b.kind === "exposicao" ? "exposicao" : "evento", starts, String(b.ends_at || ""), String(b.description || ""), String(b.image_url || ""), b.published ? 1 : 0, id);
  } else {
    db.db.prepare(`INSERT INTO events (title, kind, starts_at, ends_at, description, image_url, published, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(String(b.title || "—"), b.kind === "exposicao" ? "exposicao" : "evento", starts, String(b.ends_at || ""), String(b.description || ""), String(b.image_url || ""), b.published ? 1 : 0, now());
  }
  res.redirect("/admin/eventos");
});

router.post("/eventos/:id/acao", express.urlencoded({ extended: false }), (req, res) => {
  const id = Number(req.params.id);
  if (req.body.action === "toggle")
    db.db.prepare("UPDATE events SET published = 1 - published WHERE id = ?").run(id);
  if (req.body.action === "apagar")
    db.db.prepare("DELETE FROM events WHERE id = ?").run(id);
  res.redirect("/admin/eventos");
});

/* ---------- Novidades / Instagram ---------- */
router.get("/novidades", async (req, res) => {
  if (req.query.refresh === "1") {
    const r = await instagram.refreshLongLivedToken();
    if (!r.ok) console.error("[ig]", r.error);
  }
  const ig = await instagram.getFeed();
  const manual = db.db.prepare("SELECT * FROM news WHERE kind = 'manual' ORDER BY id DESC LIMIT 50").all();
  res.render("admin/news", {
    igPosts: ig.posts, igConfigured: ig.configured, igError: ig.error, manual, tab: "novidades",
    settings: allSettings(), username: req.session.username,
    igAuthUrl: instagram.authUrl(), igCallback: db.getSetting("ig_callback") || "",
    igEstado: String(req.query.ig || ""),
    igClientOk: Boolean(db.getSetting("ig_client_id") && db.getSetting("ig_client_secret") && db.getSetting("ig_callback")),
  });
});

/* ligar a conta: janela de autorização do Instagram (OAuth) */
router.get("/instagram/auth", (req, res) => {
  res.redirect(instagram.authUrl());
});

/* o Instagram volta com ?code= — troca por token long-lived e grava */
router.get("/instagram/callback", async (req, res) => {
  if (req.query.error) return res.redirect("/admin/novidades?ig=recusado");
  const r = await instagram.exchangeCode(String(req.query.code || ""));
  const estado = r.ok ? "ligado" : "erro:" + encodeURIComponent(r.error || "?");
  res.redirect("/admin/novidades?ig=" + estado);
});

router.post("/instagram/desligar", express.urlencoded({ extended: false }), (req, res) => {
  db.setSetting("ig_access_token", "");
  db.setSetting("ig_user_id", "");
  db.setSetting("ig_cache", "");
  res.redirect("/admin/novidades");
});

router.post("/novidades/manual", express.urlencoded({ extended: false, limit: "10mb" }), (req, res) => {
  let imageUrl = String(req.body.image_url || "").trim();
  // upload como data-url → guardado localmente em public/img/feed (permanente)
  const datauri = String(req.body.image_data || "");
  const m = datauri.match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/s);
  if (m) {
    const ext = m[1] === "jpeg" ? "jpg" : m[1];
    const nome = `feed-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const fs = require("fs");
    const path = require("path");
    const dir = path.join(__dirname, "../public/img/feed");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, nome), Buffer.from(m[2], "base64"));
    imageUrl = "/img/feed/" + nome;
  }
  db.db.prepare("INSERT INTO news (kind, caption, image_url, published, created_at) VALUES ('manual', ?, ?, 1, ?)")
    .run(String(req.body.caption || ""), imageUrl, now());
  res.redirect("/admin/novidades");
});

router.post("/novidades/:id/acao", express.urlencoded({ extended: false }), (req, res) => {
  const id = Number(req.params.id);
  if (req.body.action === "toggle") db.db.prepare("UPDATE news SET published = 1 - published WHERE id = ?").run(id);
  if (req.body.action === "apagar") db.db.prepare("DELETE FROM news WHERE id = ?").run(id);
  res.redirect("/admin/novidades");
});

/* ---------- Chat moderação ---------- */
router.get("/chat", (req, res) => {
  const msgs = db.db.prepare("SELECT * FROM messages ORDER BY id DESC LIMIT 200").all();
  res.render("admin/chat_mod", { msgs, tab: "chat", settings: allSettings(), username: req.session.username });
});

router.post("/chat/:id/acao", express.urlencoded({ extended: false }), (req, res) => {
  const id = Number(req.params.id);
  if (req.body.action === "toggle") db.db.prepare("UPDATE messages SET hidden = 1 - hidden WHERE id = ?").run(id);
  if (req.body.action === "apagar") db.db.prepare("DELETE FROM messages WHERE id = ?").run(id);
  res.redirect("/admin/chat");
});

/* ---------- Definições ---------- */
router.get("/definicoes", (req, res) => {
  res.render("admin/settings", { tab: "definicoes", s: allSettings(), username: req.session.username, saved: req.query.saved === "1" });
});

const SETTING_FIELDS = [
  "store_name", "store_address", "store_hours", "store_email", "store_phone",
  "shipping_cents", "free_shipping_cents", "iban", "mbway", "chat_welcome",
  "stream_url",
  "ig_access_token", "ig_user_id", "ig_handle",
  "ig_client_id", "ig_client_secret", "ig_callback",
  "moloni_client_id", "moloni_client_secret", "moloni_username", "moloni_company_id",
  "moloni_customer_id", "moloni_generic_product_id", "moloni_vat_id", "moloni_enabled",
];

router.post("/definicoes", express.urlencoded({ extended: false }), (req, res) => {
  for (const key of SETTING_FIELDS) {
    if (key in req.body) db.setSetting(key, String(req.body[key]).trim());
  }
  res.redirect("/admin/definicoes?saved=1");
});

/* ---------- Conta ---------- */
router.post("/conta", express.urlencoded({ extended: false }), (req, res) => {
  const { hashPassword } = require("../src/auth");
  const crypto = require("crypto");
  const pw = String(req.body.new_password || "");
  if (pw.length < 8) return res.redirect("/admin/definicoes");
  const salt = crypto.randomBytes(16).toString("hex");
  db.db.prepare("UPDATE users SET pw_hash = ?, salt = ? WHERE id = ?").run(hashPassword(pw, salt), salt, req.session.userId);
  res.redirect("/admin/definicoes?saved=1");
});

module.exports = { router };
