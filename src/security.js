"use strict";
/* Rate limiting em memória (zero-deps) + cabeçalhos de segurança.
   Suficiente para uma instância única (VPS/Render). Para multi-instância,
   trocar por um store partilhado (Redis). */

function rateLimit({ windowMs, max, message = "demasiados pedidos, tenta mais tarde" }) {
  const hits = new Map(); // ip -> { count, resetAt }
  const timer = setInterval(() => {
    const t = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
  }, Math.max(windowMs, 60_000));
  if (timer.unref) timer.unref();

  return function limiter(req, res, next) {
    const key = req.ip || (req.socket && req.socket.remoteAddress) || "?";
    const t = Date.now();
    let e = hits.get(key);
    if (!e || e.resetAt <= t) { e = { count: 0, resetAt: t + windowMs }; hits.set(key, e); }
    e.count++;
    if (e.count > max) {
      res.set("Retry-After", String(Math.ceil((e.resetAt - t) / 1000)));
      const wantsJson = req.xhr || (req.get("accept") || "").includes("application/json");
      if (wantsJson) return res.status(429).json({ error: message });
      return res.status(429).send(message);
    }
    next();
  };
}

function securityHeaders(req, res, next) {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "SAMEORIGIN");
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.set("X-XSS-Protection", "0");
  if (process.env.TRUST_PROXY && req.secure) {
    res.set("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
  next();
}

module.exports = { rateLimit, securityHeaders };
