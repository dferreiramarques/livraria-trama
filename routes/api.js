"use strict";
const express = require("express");
const crypto = require("crypto");
const db = require("../src/db");

const router = express.Router();

/* ---------- Livro à sorte (cometa ☄) ---------- */
router.get("/random", (req, res) => {
  const rows = db.db.prepare("SELECT id FROM books WHERE status = 'available' AND stock > 0").all();
  if (!rows.length) return res.status(404).json({ error: "catalongo vazio" });
  const pick = rows[Math.floor(Math.random() * rows.length)];
  res.json({ url: "/livro/" + pick.id });
});

/* ---------- Autocomplete da search bar central ---------- */
router.get("/search", (req, res) => {
  const q = (req.query.q || "").trim();
  if (q.length < 2) return res.json({ results: [] });
  const { searchBooks } = require("./public");
  res.json({
    results: searchBooks(q).slice(0, 8).map((b) => ({
      id: b.id,
      title: b.title,
      author: b.author,
      publisher: b.publisher,
      isbn: b.isbn,
      price: (b.price_cents / 100).toFixed(2).replace(".", ",") + "€",
      category: b.category,
    })),
  });
});

/* ---------- Chat anónimo, web dos anos 2000 ---------- */
const NICKS = ["bibliotecario53", "corvo_de_carvao", "sablique", "inktarot", "railgun_walrus", "cadernolumaco"];

router.get("/chat/list", (req, res) => {
  const since = Math.max(0, Number(req.query.since) || 0);
  const rows = db.db
    .prepare("SELECT id, nick, body, created_at FROM messages WHERE hidden = 0 AND id > ? ORDER BY id ASC LIMIT 60")
    .all(since);
  const count = db.db.prepare("SELECT COUNT(*) AS c FROM messages WHERE hidden = 0").get().c;
  res.json({ messages: rows, online: 1 + ((count * 7) % 11), seedNicks: NICKS });
});

router.post("/chat/send", express.json(), (req, res) => {
  const body = (req.body && req.body.body || "").trim();
  const nick = ((req.body && req.body.nick) || NICKS[crypto.randomInt(NICKS.length)]).trim().slice(0, 18);
  const ipHash = crypto.createHash("sha256").update((req.ip || "") + (process.env.CHAT_SALT || "trama")).digest("hex").slice(0, 24);
  if (!body || body.length > 420) return res.status(400).json({ error: "mensagem vazia ou comprimento excede o limite" });
  if (nick.length < 2 || /^[a-z0-9_.-]+$/i.test(nick) === false) return res.status(400).json({ error: "nick com caracteres estranhos" });

  const recent = db.db
    .prepare("SELECT created_at FROM messages WHERE ip_hash = ? ORDER BY id DESC LIMIT 3")
    .all(ipHash);
  const spammy = recent.length >= 3 && Date.now() - new Date(recent[recent.length - 1].created_at) < 25_000;
  if (spammy) return res.status(429).json({ error: "respira. vai devagar - o canal aguenta." });

  db.db.prepare("INSERT INTO messages (nick, body, ip_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(nick, body, ipHash, db.now());
  res.status(201).json({ ok: true });
});

/* ---------- Cart lookup (para a página do carrinho) ---------- */
router.post("/cart/lookup", express.json(), (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  if (!ids.length) return res.json({ items: [] });
  const ph = ids.map(() => "?").join(",");
  const rows = db.db
    .prepare(`SELECT id, title, author, price_cents, stock, cover_url FROM books WHERE id IN (${ph}) AND status = 'available'`)
    .all(...ids);
  res.json({ items: rows });
});

/* ---------- Stripe webhook ---------- */
router.post("/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const payments = require("../src/payments");
  const stripe = payments.getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return res.status(503).send("webhook não configurado");
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], secret);
  } catch (err) {
    return res.status(400).send("assinatura inválida: " + err.message);
  }
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    if (session.payment_status === "paid") {
      db.db.prepare(
        `UPDATE orders SET payment_status = 'paid', status = CASE WHEN status = 'new' THEN 'confirmed' ELSE status END,
         updated_at = ? WHERE stripe_session_id = ?`
      ).run(db.now(), session.id);
      const order = db.db.prepare("SELECT * FROM orders WHERE stripe_session_id = ?").get(session.id);
      if (order) {
        require("../src/moloni").createInvoiceForOrder(order,
          db.db.prepare("SELECT title, qty, unit_price_cents FROM order_items WHERE order_id = ?").all(order.id)
        ).catch(() => {});
      }
    }
  }
  res.json({ received: true });
});

module.exports = { router };
