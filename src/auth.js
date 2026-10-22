"use strict";
const crypto = require("crypto");
const db = require("./db");

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function createAdmin(username, password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const existing = db.db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) return existing.id;
  const res = db.db
    .prepare("INSERT INTO users (username, pw_hash, salt, created_at) VALUES (?, ?, ?, ?)")
    .run(username, hashPassword(password, salt), salt, db.now());
  return Number(res.lastInsertRowid);
}

function verifyUser(username, password) {
  const row = db.db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!row) return null;
  const candidate = hashPassword(password, String(row.salt));
  const ok =
    candidate.length === String(row.pw_hash).length &&
    crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(String(row.pw_hash)));
  return ok ? { id: Number(row.id), username: row.username } : null;
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.userId) return next();
  if (req.accepts("html")) return res.redirect("/admin/login?next=" + encodeURIComponent(req.originalUrl));
  return res.status(401).json({ error: "não autenticado" });
}

module.exports = { createAdmin, verifyUser, requireAdmin, hashPassword };
