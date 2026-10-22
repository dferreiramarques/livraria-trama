const cartKey = "trama-cart";

function readCart() {
  try { return JSON.parse(localStorage.getItem(cartKey)) || []; } catch { return []; }
}
function writeCart(items) {
  localStorage.setItem(cartKey, JSON.stringify(items));
  updateBadge();
}
function addToCart(id, title) {
  const items = readCart();
  const line = items.find((i) => i.id === id);
  if (line) line.qty = Math.min(9, line.qty + 1);
  else items.push({ id, qty: 1, title });
  writeCart(items);
  if (typeof flashCart === "function") flashCart(title);
}
function updateBadge() {
  const el = document.getElementById("cesto-count");
  if (!el) return;
  const n = readCart().reduce((s, i) => s + i.qty, 0);
  el.textContent = String(n);
}
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".adicionar");
  if (btn) addToCart(Number(btn.dataset.id), btn.dataset.title);
});

/* Cometa + cliques do catálogo: modal de livro, sem mudar de página */
/* strings da modal por idioma (o <body data-lang> decide) */
const MODAL_TXT = {
  pt: { ultimo: "último exemplar à vista", prateleira: "em prateleira", add: "ao cesto", added: "no cesto ✓" },
  en: { ultimo: "last copy in sight", prateleira: "on the shelf", add: "add to cart", added: "in the cart ✓" },
};
const MT = MODAL_TXT[document.body.dataset.lang] || MODAL_TXT.pt;

function abrirLivroModal(id) {
  const modal = document.getElementById("livro-modal");
  if (!modal) return;
  fetch("/api/livro/" + id)
    .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
    .then(({ livro: b }) => {
      if (!b) return;
      const cap = document.getElementById("modal-capa");
      const vazia = document.getElementById("modal-capa-vazia");
      document.getElementById("modal-titulo").textContent = b.title;
      document.getElementById("modal-autor").textContent = b.author || "";
      document.getElementById("modal-cat").textContent = b.category || "";
      document.getElementById("modal-ficha").textContent =
        [b.publisher, b.isbn && "ISBN " + b.isbn].filter(Boolean).join(" · ");
      document.getElementById("modal-preco").textContent =
        (b.price_cents / 100).toFixed(2).replace(".", ",") + "€";
      document.getElementById("modal-stock").textContent =
        b.stock === 1 ? MT.ultimo : b.stock + " " + MT.prateleira;
      document.getElementById("modal-desc").textContent = b.description || "";
      if (b.cover_url) { cap.src = b.cover_url; cap.hidden = false; vazia.hidden = true; }
      else { cap.hidden = true; vazia.hidden = false; }
      document.getElementById("modal-ficha-link").href = "/livro/" + b.id;
      const btn = document.getElementById("modal-adicionar");
      btn.textContent = MT.add;
      btn.disabled = false;
      document.getElementById("modal-feedback").textContent = "";
      btn.onclick = () => { addToCart(b.id, b.title); btn.textContent = MT.added; btn.disabled = true; };
      modal.hidden = false;
      document.body.style.overflow = "hidden";
    })
    .catch(() => { location.href = "/livro/" + id; }); // sem js data → ficha clássica
}
function fecharLivroModal() {
  const modal = document.getElementById("livro-modal");
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  document.body.style.overflow = "";
}
document.addEventListener("click", async (e) => {
  // fechar: fundo ou ✕
  if (e.target.closest("[data-fechar]")) { fecharLivroModal(); return; }
  // links "surpreende-me": sorte + mesma modal
  const sorte = e.target.closest("a[data-surpresa]");
  if (sorte) {
    e.preventDefault();
    try {
      const r = await fetch("/api/random");
      if (r.ok) abrirLivroModal(Number((await r.json()).url.split("/").pop()));
    } catch { location.href = "/surpresa"; }
    return;
  }
  // livreto do catálogo: intercepta e abre modal
  const link = e.target.closest("a[data-livro]");
  if (link) {
    e.preventDefault();
    abrirLivroModal(Number(link.dataset.livro));
  }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") fecharLivroModal(); });

document.addEventListener("click", async (e) => {
  if (!e.target.closest("#cometa")) return;
  try {
    const r = await fetch("/api/random");
    if (r.ok) abrirLivroModal(Number((await r.json()).url.split("/").pop()));
    else location.href = "/surpresa";
  } catch { /* silêncio, tipo poema dactilografado */ }
});

/* Autocomplete da barra central */
(function () {
  const input = document.getElementById("q");
  const box = document.getElementById("sugestoes");
  if (!input || !box) return;
  let timer = null;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { box.hidden = true; return; }
    timer = setTimeout(async () => {
      const res = await fetch("/api/search?q=" + encodeURIComponent(q));
      const data = await res.json();
      box.innerHTML = data.results.map((r) =>
        `<a href="/livro/${r.id}"><b>${r.title}</b><span>${r.author || ""}${r.category ? " · " + r.category : ""} · ${r.price}</span></a>`
      ).join("") || `<span class="nenhum">nada para “${q}”</span>`;
      box.hidden = false;
    }, 160);
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") box.hidden = true; });
  document.addEventListener("click", (e) => { if (!box.contains(e.target)) box.hidden = true; });
})();

updateBadge();
