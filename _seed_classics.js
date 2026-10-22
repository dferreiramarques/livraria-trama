"use strict";
/* Povoa o catálogo com clássicos via ISBN (Google Books → Open Library) */
const db = require("./src/db");
const gb = require("./src/googleBooks");

const candidates = [
  { isbn: "9780141439518", cat: "clássicos", preco: 1290 },   // Orgulho e Preconceito (Penguin)
  { isbn: "9780553213418", cat: "clássicos", preco: 1190 },   // Moby-Dick (Bantam)
  { isbn: "9780451524935", cat: "distopia", preco: 1390 },    // Fahrenheit 451 (Ballantine)
  { isbn: "9780099540475", cat: "clássicos", preco: 1590 },   // Crime e Castigo (Vintage)
  { isbn: "9780199537062", cat: "clássicos", preco: 1790 },   // Ulysses (Oxford)
  { isbn: "9780241955633", cat: "clássicos", preco: 1490 },   // O Mestre e Margarita (Penguin)
  { isbn: "9780140449136", cat: "clássicos", preco: 1650 },   // Odisseia (Penguin Classics)
  { isbn: "9780140449105", cat: "poesia", preco: 1550 },      // Ilíada (Penguin Classics)
  { isbn: "9780553212435", cat: "clássicos", preco: 1250 },   // Frankenstein (Bantam)
  { isbn: "9780393354385", cat: "política", preco: 1690 },    // Leviatã? (Norton)
  { isbn: "9780140444087", cat: "filosofia", preco: 1450 },   // Meditações de Marco Aurélio
  { isbn: "9780141199230", cat: "filosofia", preco: 1350 },   // Arte da Guerra? (Penguin Great Ideas)
];

(async () => {
  let feitos = 0;
  for (const c of candidates) {
    if (feitos >= 10) break;
    try {
      const dup = db.db.prepare("SELECT id FROM books WHERE isbn = ?").get(c.isbn);
      if (dup) { console.log(c.isbn, "já existe (id " + dup.id + ")"); continue; }
      const d = await gb.lookupByIsbn(c.isbn);
      if (!d) { console.log(c.isbn, "→ sem dados; salto, desde que apareça outra fonte."); continue; }
      if (!d.cover_url) { console.log(c.isbn, "→ sem capa, mas dados OK."); } // ol-cover probe já validado
      db.db.prepare(
        `INSERT INTO books (title, author, publisher, isbn, category, price_cents, stock, status, description, cover_url, featured, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, 'available', ?, ?, ?, ?, ?)`
      ).run(d.title || "(sem título)", d.author, d.publisher, d.isbn, c.cat, c.preco,
            d.description || "", d.cover_url, feitos < 4 ? 1 : 0, db.now(), db.now());
      console.log(c.isbn, "->", d.title, "|", d.author, "| fonte:", d.source, d.cover_url ? "(capa ok)" : "(sem capa)");
      feitos++;
    } catch (e) {
      console.log(c.isbn, "ERRO:", e.message.slice(0, 80));
    }
  }
  console.log("inscritos novos:", feitos);
  console.log("total no catálogo:", db.db.prepare("SELECT COUNT(*) AS n FROM books").get().n);
})();
