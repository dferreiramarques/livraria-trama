"use strict";
/* Auto-completar fichas por ISBN
   1ª fonte: Google Books (público, opcional GOOGLE_BOOKS_KEY)
   fallback: Open Library (público, sem chave) */

const gbAPI = "https://www.googleapis.com/books/v1/volumes?q=isbn:";

function cleanIsbn(isbn) {
  return String(isbn || "").replace(/[^0-9Xx]/g, "");
}

async function gbLookup(clean) {
  const url = gbAPI + encodeURIComponent(clean) + (process.env.GOOGLE_BOOKS_KEY ? "&key=" + process.env.GOOGLE_BOOKS_KEY : "");
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  } catch {
    throw new Error("sem resposta do Google Books (rede/timeout)");
  }
  if (res.status === 429) throw new Error("limite temporário do Google; a abrir Open Library");
  if (!res.ok) throw new Error("Google Books respondeu " + res.status);
  const data = await res.json();
  if (!data.totalItems || !data.items || !data.items.length) return null;

  const item = data.items.find((it) =>
    (it.volumeInfo.industryIdentifiers || []).some((i) => i.identifier.replace(/[^0-9Xx]/g, "") === clean)
  ) || data.items[0];
  const v = item.volumeInfo || {};

  let cover = "";
  if (v.imageLinks) {
    cover = v.imageLinks.thumbnail || v.imageLinks.smallThumbnail || "";
    cover = cover.replace(/^http:\/\//, "https://").replace(/&edge=\w+/, "").replace(/&zoom=\d+/, "&zoom=2");
  }

  return {
    title: [v.title, v.subtitle].filter(Boolean).join(": "),
    author: (v.authors || []).join(", "),
    publisher: v.publisher || "",
    isbn: clean,
    description: v.description || "",
    cover_url: cover,
    category: (v.categories || [""])[0] || "",
    year: (v.publishedDate || "").slice(0, 4),
    source: "google",
  };
}

async function olLookup(clean) {
  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${clean}&format=json&jscmd=data`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  } catch {
    throw new Error("sem resposta do Open Library (rede/timeout)");
  }
  if (!res.ok) throw new Error("Open Library respondeu " + res.status);
  const b = (await res.json())["ISBN:" + clean];
  if (!b) return null;

  const ident = (b.identifiers || {}).isbn_13 || [];
  const isbn13 = String(ident[0] || clean).replace(/[^0-9Xx]/g, "");
  let cover = "";
  if (b.cover) cover = b.cover.large || b.cover.medium || b.cover.small || "";
  if (!cover) {
    // capa estática do Open Library — valida com HEAD, sem 404 no SSR
    try {
      const probe = await fetch(`https://covers.openlibrary.org/b/isbn/${clean}-L.jpg?default=false`, {
        method: "HEAD", signal: AbortSignal.timeout(5000),
      });
      if (probe.ok) cover = `https://covers.openlibrary.org/b/isbn/${clean}-L.jpg`;
    } catch { /* sem capa */ }
  }

  let description = b.notes || "";
  if (!description && b.excerpts && b.excerpts.length) description = b.excerpts[0].text;
  // descrição completa às vezes vive no work: um extra pedido quando há chave
  if (!description) {
    try {
      const veryRare = await fetch(`https://openlibrary.org/isbn/${clean}.json`, { signal: AbortSignal.timeout(5000) });
      if (veryRare.ok) {
        const details = await veryRare.json();
        description = details.description ? (details.description.value || details.description) : "";
      }
    } catch { /* opcional */ }
  }

  return {
    title: [b.title, b.subtitle].filter(Boolean).join(": "),
    author: (b.authors || []).map((a) => a.name).join(", "),
    publisher: (b.publishers || []).map((p) => p.name).join(", "),
    isbn: isbn13 || clean,
    description,
    cover_url: cover,
    category: (b.subjects || []).map((s) => s.name).slice(0, 2).join(", "),
    year: b.publish_date || "",
    source: "openlibrary",
  };
}

/** Ficha completa do ISBN, Google → Open Library. null quando não há dados. */
async function lookupByIsbn(isbn) {
  const clean = cleanIsbn(isbn);
  if (clean.length < 9) return null;

  let gbError = null;
  try {
    const g = await gbLookup(clean);
    if (g) return g;
  } catch (err) {
    gbError = err;
  }
  try {
    const o = await olLookup(clean);
    if (o) return o;
  } catch (err) {
    // erro de rede/limite no OL: dá a mensagem, mas nota também o que correu no Google
    throw new Error((gbError ? gbError.message + " · " : "") + err.message);
  }
  return null; // nem Google nem OL — ISBN não existe nas duas fontes
}

module.exports = { lookupByIsbn };
