"use strict";
require("dotenv").config();
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const db = require("./src/db");
const { t, langs } = require("./src/i18n");
const { createAdmin } = require("./src/auth");
const publicRoutes = require("./routes/public");
const apiRoutes = require("./routes/api");
const adminRoutes = require("./routes/admin");

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

if (process.env.TRUST_PROXY) app.set("trust proxy", 1);

app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: "auto", maxAge: 12 * 3600 * 1000 },
}));

/* idioma PT/EN via cookie ?idioma= (as views usam t('chave')) */
app.use((req, res, next) => {
  if (req.query.idioma && langs.includes(req.query.idioma)) {
    res.cookie("lang", req.query.idioma, { maxAge: 365 * 24 * 3600 * 1000, httpOnly: false, sameSite: "lax" });
    req.headers.lang = req.query.idioma;
    return res.redirect(303, req.originalUrl.replace(/[?&]idioma=[a-z]+/, ""));
  }
  const cookies = String(req.headers.cookie || "");
  const mCookie = cookies.match(/(?:^|;\s*)lang=(pt|en)\b/);
  res.locals.lang = (req.headers.lang || (mCookie && mCookie[1]) || "pt");
  res.locals.t = (key) => t(res.locals.lang, key);
  res.locals.req = req;
  next();
});

// Cria o primeiro utilizador admin, se a BD estiver vazia; se ADMIN_PASSWORD
// estiver definido no ambiente, redefine a password do admin em cada arranque (para deploys).
function setAdminPassword(username, password) {
  const salt = crypto.randomBytes(16).toString("hex");
  db.db.prepare("UPDATE users SET pw_hash = ?, salt = ? WHERE username = ?")
    .run(require("./src/auth").hashPassword(password, salt), salt, username);
}
(function bootstrapAdmin() {
  const user = process.env.ADMIN_USER || "trama";
  if (process.env.ADMIN_PASSWORD) {
    setAdminPassword(user, process.env.ADMIN_PASSWORD);
    console.log(`[bootstrap] password do admin "${user}" sincronizada a partir do ambiente.`);
    return;
  }
  const row = db.db.prepare("SELECT COUNT(*) AS c FROM users").get();
  if (row.c === 0) {
    const user = process.env.ADMIN_USER || "trama";
    const pass = process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString("hex");
    createAdmin(user, pass);
    console.log(`[bootstrap] utilizador admin criado → utilizador: ${user} | password: ${pass}`);
    console.log("[bootstrap] guarda-a e muda-a em Definições → Conta.");
  }
})();

app.use("/api", apiRoutes.router);
app.use(publicRoutes.router);
app.use("/admin", adminRoutes.router);

app.use((req, res) => {
  res.status(404).render("404", { settings: publicRoutes.allSettings() });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("[erro]", err);
  res.status(500).send("Algo rebentou nas costuras. Tenta outra vez.");
});

app.listen(PORT, () => {
  console.log(`Trama a tecer-se em ${BASE_URL}`);
});
