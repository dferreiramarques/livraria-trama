"use strict";
/* Dados de demonstração — correr com: npm run seed */
const db = require("./db");

const books = [
  {
    title: "A Solidão é esta Casa de Espelhos", author: "Maria Filomena Molder", publisher: "Assírio & Alvim",
    isbn: "978-972-370-000-0", category: "poesia", price_cents: 1690, stock: 3, featured: 1,
    description: "Novos poemas sobre espelhos, sombras e o que a luz descobre quando ninguém olha.",
  },
  {
    title: "Crítica da Razão Comiquera", author: "Escritor Anónimo", publisher: "Edições Tralha",
    isbn: "978-972-370-000-1", category: "filosofia", price_cents: 1290, stock: 7, featured: 1,
    description: "Um ensaio afinado sobre o que os comics nos ensinam — sem saber dançar, sabendo saltar.",
  },
  {
    title: "A Cidade à Lucidez", author: "Paula Tavares (ilustr.)", publisher: "Como em Sonho",
    isbn: "978-972-370-000-2", category: "artes", price_cents: 2200, stock: 2, featured: 0,
    description: "Caderno de piscar de olhos ao Porto: aguarelas, brasas e letreiros.",
  },
  {
    title: "Comics fazem Bem à Cabeça", author: "Diversos", publisher: "Fan Publications",
    isbn: "978-972-370-000-3", category: "comics", price_cents: 1830, stock: 5, featured: 1,
    description: "Antologia com tebdorote que dobra em aprender das costas — e faz atirar para acá.",
  },
  {
    title: "Filosofia no Bolso (sem telemóvel)", author: "Clube da Trama", publisher: "Boca do Inferno",
    isbn: "978-972-370-000-4", category: "filosofia", price_cents: 990, stock: 9, featured: 0,
    description: "Guia de bolso, na mão e parcialmente ao contrário, para quem quer pensar em movimento.",
  },
];

const events = [
  {
    title: "Abertura do semestre: conversa sobre comunicação com o corpo",
    kind: "evento", starts_at: "2026-11-04T19:00", description: "Conversa de estreia às novas terceiras quintas de cada mês. Livros, uma mesa, e perguntas sem perguntas.",
    published: 1,
  },
  {
    title: "Exposição: Bragas, 32 — a rua em cem desenhos",
    kind: "exposicao", starts_at: "2026-11-10T11:00", ends_at: "2026-12-20T18:00",
    description: "Cemicimilidade do espaço do bairro, desenhadas em lápis turquia redondo e acabamento em branco vulgaris na livraria. Lado B perto de ti.", published: 1,
  },
];

const news = [
  {
    caption: "Novos comics chegados esta terça — atenção ao xilófone.",
    image_url: "",
  },
];

for (const b of books) {
  const count = db.db.prepare("SELECT COUNT(*) AS c FROM books WHERE isbn = ?").get(b.isbn).c;
  if (!count) {
    db.db.prepare(
      `INSERT INTO books (title, author, publisher, isbn, category, price_cents, stock, status, description, cover_url, featured, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'available', ?, '', ?, ?, ?)`
    ).run(b.title, b.author, b.publisher, b.isbn, b.category, b.price_cents, b.stock, b.description, b.featured, db.now(), db.now());
  }
}
for (const e of events) {
  const count = db.db.prepare("SELECT COUNT(*) AS c FROM events WHERE title = ?").get(e.title).c;
  if (!count) {
    db.db.prepare(
      "INSERT INTO events (title, kind, starts_at, ends_at, description, image_url, published, created_at) VALUES (?, ?, ?, ?, ?, '', ?, ?)"
    ).run(e.title, e.kind, e.starts_at, e.ends_at || "", e.description, e.published, db.now());
  }
}
for (const n of news) {
  const count = db.db.prepare("SELECT COUNT(*) AS c FROM news WHERE caption = ?").get(n.caption).c;
  if (!count) {
    db.db.prepare("INSERT INTO news (kind, caption, image_url, published, created_at) VALUES ('manual', ?, ?, 1, ?)")
      .run(n.caption, n.image_url, db.now());
  }
}
console.log("Seed feito: 5 livros, 2 eventos, 1 novidade (só se ainda não existissem).");
