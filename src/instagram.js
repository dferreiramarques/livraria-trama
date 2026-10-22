"use strict";
const db = require("./db");

const GRAPH = "https://graph.instagram.com/v26.0";
const TTL_MS = 30 * 60 * 1000; // refresca a cada 30 min

function configured() {
  return Boolean(db.getSetting("ig_access_token"));
}

/**
 * Devolve posts da conta profissional do Instagram.
 * Token long-lived gerado no painel da Meta (60 dias) + user id guardados nas Definições.
 * Faz cache na BD para não esmagar os limites de rate.
 */
/**
 * Modo demo (sem token/conta Meta): lê o perfil público pelo endpoint web
 * que o próprio site do Instagram usa. Depende de rate-limits do IG
 * (daí o cache de 30 min) e pode falhar → a home cai no embed.
 */
async function fetchPublicFeed(handle) {
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`;
  const res = await fetch(url, {
    headers: {
      "x-ig-app-id": "936619743392459",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
      "accept": "*/*",
      "referer": `https://www.instagram.com/${handle}/`,
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error("IG público " + res.status);
  const data = await res.json();
  const user = data && data.data && data.data.user;
  const edges = user && user.edge_owner_to_timeline_media && user.edge_owner_to_timeline_media.edges;
  if (!edges || !edges.length) throw new Error("IG público sem posts");
  return edges.slice(0, 12).map(({ node }) => ({
    id: node.id,
    caption: (node.edge_media_to_caption.edges[0] || {}).node
      ? node.edge_media_to_caption.edges[0].node.text.split("\n")[0].slice(0, 200)
      : "",
    image: node.thumbnail_src || (node.display_url || ""),
    permalink: "https://www.instagram.com/p/" + (node.shortcode || "") + "/",
    timestamp: null,
  }));
}

async function getFeed() {
  const raw = db.getSetting("ig_cache");
  if (raw) {
    try {
      const cached = JSON.parse(raw);
      if (Date.now() - cached.ts < TTL_MS) return { posts: cached.posts, stale: false, configured: configured() };
    } catch { /* cache corrompida → refetch */ }
  }
  if (configured()) {
    try {
      const userId = db.getSetting("ig_user_id") || "me";
      const params = new URLSearchParams({
        fields: "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp",
        access_token: db.getSetting("ig_access_token"),
        limit: "12",
      });
      const res = await fetch(`${GRAPH}/${userId}/media?${params}`);
      if (!res.ok) throw new Error("Instagram Graph API " + res.status);
      const data = await res.json();
      const posts = (data.data || [])
        .filter((m) => m.media_type !== "VIDEO" || m.thumbnail_url)
        .map((m) => ({
          id: m.id,
          caption: (m.caption || "").split("\n")[0].slice(0, 200),
          image: m.thumbnail_url || m.media_url,
          permalink: m.permalink,
          timestamp: m.timestamp,
        }));
      db.setSetting("ig_cache", JSON.stringify({ ts: Date.now(), posts }));
      return { posts, stale: false, configured: true };
    } catch (err) {
      console.error("[instagram]", err.message);
      return {
        posts: raw ? JSON.parse(raw).posts : [],
        stale: true,
        configured: true,
        error: err.message,
      };
    }
  }
  // sem token: tenta o modo demo público
  const handle = (db.getSetting("ig_handle") || "instagram").replace(/^@/, "");
  try {
    const posts = await fetchPublicFeed(handle);
    db.setSetting("ig_cache", JSON.stringify({ ts: Date.now(), posts }));
    return { posts, stale: false, demo: true };
  } catch (err) {
    console.error("[instagram/demo]", err.message);
    return { posts: raw ? JSON.parse(raw).posts : [], stale: true, demo: false, error: err.message };
  }
}

/** Refresca o token long-lived (ig_refresh_token), válido ~60 dias por refresh. */
async function refreshLongLivedToken() {
  const token = db.getSetting("ig_access_token");
  if (!token) return { ok: false, error: "sem token" };
  const res = await fetch(
    `${GRAPH}/refresh_access_token?grant_type=ig_refresh_token&access_token=${token}`
  );
  if (!res.ok) return { ok: false, error: "refresh falhou (" + res.status + ")" };
  const data = await res.json();
  db.setSetting("ig_access_token", data.access_token);
  return { ok: true };
}

/**
 * Fluxo OAuth "Instagram API with Instagram Login":
 * troca ?code= por token curto (1h) → long-lived (60 dias) → guarda token + user id.
 */
async function exchangeCode(code) {
  const cid = db.getSetting("ig_client_id");
  const csec = db.getSetting("ig_client_secret");
  const cb = db.getSetting("ig_callback");
  if (!cid || !csec || !cb) return { ok: false, error: "faltam Client ID / Secret / callback nas Definições" };
  const corpo = new URLSearchParams({
    client_id: cid, client_secret: csec,
    grant_type: "authorization_code", redirect_uri: cb, code,
  });
  const r1 = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: corpo.toString(),
  });
  if (!r1.ok) return { ok: false, error: "troca do code falhou (" + r1.status + ") " + (await r1.text()).slice(0, 200) };
  const t1 = await r1.json();
  const userId = String(t1.user_id || "");
  const r2 = await fetch(
    `${GRAPH}/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(csec)}&access_token=${encodeURIComponent(t1.access_token)}`
  );
  if (!r2.ok) return { ok: false, error: "token long-lived falhou (" + r2.status + ") " + (await r2.text()).slice(0, 200) };
  const t2 = await r2.json();
  db.setSetting("ig_access_token", t2.access_token);
  db.setSetting("ig_cache", "");
  if (userId) db.setSetting("ig_user_id", userId);
  return { ok: true, user_id: userId };
}

/** URL de autorização da conta Instagram (o utilizador entra na janela e dá permissão). */
function authUrl() {
  const cid = db.getSetting("ig_client_id");
  const cb = db.getSetting("ig_callback");
  const p = new URLSearchParams({
    client_id: cid || "",
    redirect_uri: cb || "",
    response_type: "code",
    scope: "instagram_business_basic",
  });
  return "https://www.instagram.com/oauth/authorize?" + p.toString();
}

module.exports = { getFeed, refreshLongLivedToken, configured, exchangeCode, authUrl };
