"use strict";
const nodemailer = require("nodemailer");
const db = require("./db");

let transporter = null;
function getTransporter() {
  if (!process.env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "1",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  }
  return transporter;
}

const FROM = () => process.env.MAIL_FROM || db.getSetting("store_email") || "livrariatrama@gmail.com";

async function send(to, subject, text) {
  const tx = getTransporter();
  if (!tx) {
    console.log(`[mail:console] para=${to} assunto="${subject}"\n${text}\n`);
    return { delivered: false, mode: "console" };
  }
  try {
    await tx.sendMail({ from: FROM(), to, subject, text });
    return { delivered: true, mode: "smtp" };
  } catch (err) {
    console.error("[mail] erro:", err.message);
    return { delivered: false, mode: "error", error: err.message };
  }
}

function orderPlaced(order, items) {
  const lines = items.map((i) => `  • ${i.title} — ${i.qty}× ${(i.unit_price_cents / 100).toFixed(2)}€`).join("\n");
  const total = (order.total_cents / 100).toFixed(2);
  const delivery = order.delivery === "pickup" ? "Recolha na loja (Rua dos Bragas, 32, Porto)" : "Envio ao domicílio";
  const pay = { stripe: "online (cartão/Multibanco/MB WAY)", transfer: "transferência bancária", store: "pagamento na loja" }[order.payment_method] || order.payment_method;
  return send(
    order.email,
    `Livraria Trama — encomenda ${order.code} recebida`,
`Obrigado, ${order.name}!

Recebemos a tua encomenda ${order.code}:
${lines}
  Envio: ${delivery}
  Pagamento: ${pay}

Total: ${total}€

${order.payment_method === "transfer"
  ? `Para pagamento por transferência:\nIBAN: ${db.getSetting("iban") || "(ver site)"} — NIB/MB WAY: ${db.getSetting("mbway") || "(ver site)"}\nMenciona o código ${order.code} na transferência.`
  : order.payment_method === "store"
  ? "Podes pagar na recolha, na loja."
  : "Se ainda não pagaste, conclui o pagamento na página da encomenda."}

Estado e pagamento: ${process.env.BASE_URL || "http://localhost:3000"}/encomenda/${order.code}

Livraria Trama — Rua dos Bragas, 32, Porto`
  );
}

function orderShipped(order) {
  return send(order.email, `Livraria Trama — encomenda ${order.code} enviada`, `${order.name}, a tua encomenda ${order.code} seguiu para o correio. Bem-vindo de volta!\n\nLivraria Trama`);
}

function orderReady(order) {
  return send(order.email, `Livraria Trama — encomenda ${order.code} pronta para recolha`, `${order.name}, a tua encomenda ${order.code} está pronta à espera de ti na loja:\nRua dos Bragas, 32, Porto\n${db.getSetting("store_hours")}\n\nLivraria Trama`);
}

function orderCanceled(order) {
  return send(order.email, `Livraria Trama — encomenda ${order.code} cancelada`, `${order.name}, a encomenda ${order.code} foi cancelada. Se pagou por transferência, responderemos para agendarmos a devolução.\n\nLivraria Trama`);
}

module.exports = { send, orderPlaced, orderShipped, orderReady, orderCanceled };
