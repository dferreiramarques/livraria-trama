/* Carrinho + checkout (client-side, guards Dependent views/cart.ejs) */
const cartKey = "trama-cart";
const CT = {
  pt: { total: "total:", com_envio: " (inclui {P} de envio)", err_morada: "preenche a morada de envio", falhou: "falhou", rede: "rede em baixo? tenta outra vez.", tecendo: "a tecer a encomenda…" },
  en: { total: "total:", com_envio: " (includes {P} shipping)", err_morada: "fill in the shipping address", falhou: "it failed", rede: "network down? try again.", tecendo: "weaving your order…" },
}[document.body?.dataset?.lang] || {
  total: "total:", com_envio: " (inclui {P} de envio)", err_morada: "preenche a morada de envio", falhou: "falhou", rede: "rede em baixo? tenta outra vez.", tecendo: "a tecer a encomenda…",
};
const $ = (sel) => document.querySelector(sel);

function readCart() {
  try { return JSON.parse(localStorage.getItem(cartKey)) || []; } catch { return []; }
}
function writeCart(items) {
  localStorage.setItem(cartKey, JSON.stringify(items.filter((i) => i.qty > 0)));
  render();
}
function itemsTotal(items) {
  return items.reduce((s, i) => s + i.price * i.qty, 0);
}
function eur(cents) {
  return (cents / 100).toFixed(2).replace(".", ",") + "€";
}

let cartItems = [];

async function render() {
  const list = readCart();
  const area = $("#cesto-lista");
  const form = $("#formulario-encomenda");
  const vazio = $("#cesto-vazio");
  if (!area) return;
  if (!list.length) {
    area.innerHTML = "";
    if (form) form.hidden = true;
    if (vazio) vazio.hidden = false;
    return;
  }
  if (vazio) vazio.hidden = true;
  if (form) form.hidden = false;

  const res = await fetch("/api/cart/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: list.map((i) => i.id) }),
  });
  const { items } = await res.json();
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  cartItems = list.map((c) => {
    const b = byId[c.id];
    return { id: c.id, title: b ? b.title : c.title || "livro", author: b ? b.author : "", price: b ? b.price : 0, stock: b ? b.stock : 0 };
  }).filter((i) => i.price > 0 && i.stock > 0);

  area.innerHTML = cartItems.map((i) =>
    `<div class="linha-cesto">
       <a href="/livro/${i.id}">${i.title}</a>
       <span class="tono">${i.author || ""}</span>
       <span class="qty">
         <button type="button" data-d="-1" data-id="${i.id}">−</button>
         ${i.qty}
         <button type="button" data-d="1" data-id="${i.id}">+</button>
       </span>
       <span class="num">${eur(i.price * i.qty)}</span>
     </div>`
  ).join("");

  updateTotal();
}

function computeShipping() {
  if (!$('input[name="delivery"]')) return 0;
  const delivery = document.querySelector('input[name="delivery"]:checked').value;
  const payment = document.querySelector('input[name="payment"]:checked').value;
  if (delivery !== "ship" || payment === "store") return 0;
  return itemsTotal(cartItems) < (window.TRAMA_FREE || 0) ? (window.TRAMA_SHIPPING || 0) : 0;
}
function updateTotal() {
  const linha = $("#total-linha");
  if (!linha) return;
  const total = itemsTotal(cartItems) + computeShipping();
  linha.textContent = `${CT.total} ${eur(total)}${computeShipping() ? CT.com_envio.replace("{P}", eur(computeShipping())) : ""}`;
}

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-d]");
  if (!btn) return;
  const items = readCart();
  const line = items.find((i) => i.id === Number(btn.dataset.id));
  if (line) line.qty += Number(btn.dataset.d);
  writeCart(items);
});

document.querySelectorAll('input[name="delivery"], input[name="payment"]').forEach((r) =>
  r.addEventListener("change", () => { updateTotal(); })
);
const addr = $("#endereco-campos");
document.querySelectorAll('input[name="delivery"]').forEach((r) =>
  r.addEventListener("change", () => {
    if (!addr) return;
    const d = document.querySelector('input[name="delivery"]:checked').value;
    addr.hidden = d !== "ship";
  })
);

const form = $("#formulario-encomenda");
if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!cartItems.length) return;
    const fd = new FormData(form);
    const body = {
      items: cartItems.map((i) => ({ id: i.id, qty: i.qty })),
      name: fd.get("name"), email: fd.get("email"), phone: fd.get("phone"),
      vat: fd.get("vat"), delivery: fd.get("delivery"),
      address: fd.get("address"), postal: fd.get("postal"), city: fd.get("city"),
      note: fd.get("note"), payment: fd.get("payment"),
    };
    if (body.delivery === "ship" && (!body.address || !body.postal || !body.city)) {
      addr.hidden = false;
      alert(CT.err_morada);
      return;
    }
    const btn = form.querySelector("button[type=submit]");
    const rotulo = btn.textContent;
    btn.disabled = true;
    btn.textContent = CT.tecendo;
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || CT.falhou); btn.disabled = false; btn.textContent = rotulo; return; }
      localStorage.removeItem(cartKey);
      if (data.payUrl) location.href = data.payUrl;
      else location.href = data.url;
    } catch {
      alert(CT.rede);
      btn.disabled = false;
      btn.textContent = rotulo;
    }
  });
}

// preços de envio na vista
const sEl = $("#preco-envio"), fEl = $("#grátis-envio");
if (sEl) sEl.textContent = eur(window.TRAMA_SHIPPING || 0);
if (fEl) fEl.textContent = eur(window.TRAMA_FREE || 0);
render();
