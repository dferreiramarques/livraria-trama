"use strict";
const db = require("./db");

const API_BASE = process.env.MOLONI_API_BASE || "https://api.moloni.pt/v1";
const TOKEN_URL = process.env.MOLONI_TOKEN_URL || API_BASE + "/oauth/grant.php";

function configured() {
  return Boolean(
    db.getSetting("moloni_client_id") &&
    db.getSetting("moloni_client_secret") &&
    db.getSetting("moloni_company_id")
  );
}

let cachedToken = { token: null, exp: 0 };

async function getToken() {
  if (cachedToken.token && Date.now() < cachedToken.exp) return cachedToken.token;
  const params = new URLSearchParams({
    client_id: db.getSetting("moloni_client_id"),
    client_secret: db.getSetting("moloni_client_secret"),
    grant_type: "client_credentials",
    username: db.getSetting("moloni_username") || "",
  });
  const res = await fetch(TOKEN_URL + "?" + params.toString());
  if (!res.ok) throw new Error("Moloni auth falhou (" + res.status + ") — verifica credenciais e MOLONI_TOKEN_URL em docs.moloni.pt");
  const data = await res.json();
  cachedToken = { token: data.access_token, exp: Date.now() + (data.expires_in - 600) * 1000 };
  return cachedToken.token;
}

async function moloniCall(resource, params) {
  const token = await getToken();
  const companyId = db.getSetting("moloni_company_id");
  const search = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${API_BASE}/${companyId}/${resource}/?${search.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("Resposta Moloni inválida: " + text.slice(0, 200)); }
  if (data.valid !== undefined && !data.valid && data.errors) {
    throw new Error("Moloni API: " + JSON.stringify(data.errors).slice(0, 300));
  }
  if (!res.ok) throw new Error(`Moloni API ${res.status}: ${text.slice(0, 300)}`);
  return data;
}

/**
 * Cria uma fatura-simplificada (proforma) para uma encomenda paga.
 * Configuração guardada no CMS (Definições): client_id, client_secret,
 * company_id, customer_id (cliente contínuo "Clientes Livraria").
 */
async function createInvoiceForOrder(order, items) {
  if (!configured()) return { status: "not_configured" };
  if (db.getSetting("moloni_enabled") !== "1") return { status: "disabled" };
  try {
    const document = {
      company_id: Number(db.getSetting("moloni_company_id")),
      customer_id: Number(db.getSetting("moloni_customer_id") || 0),
      document_type: "invoiceReceipt", // documentosPts: invoiceReceipt p/ faturação simples
      date: new Date().toISOString().slice(0, "YYYY-MM-DD".length),
      expiration_date: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, "YYYY-MM-DD".length),
      maturity_date: null,
      associated_document_id: null,
      notes: "Encomenda " + order.code + " — Livraria Trama",
      products: items.map((it) => ({
        product_id: Number(db.getSetting("moloni_generic_product_id") || 1),
        name: it.title,
        summary: it.title + " × " + it.qty,
        qty: it.qty,
        price: (it.unit_price_cents / 100).toFixed(2),
        vat_id: Number(db.getSetting("moloni_vat_id") || 2), // PT normal 23%
        exemptions: [],
        discount: 0,
      })),
    };
    const created = await moloniCall("documents/create", document);
    db.db
      .prepare("UPDATE orders SET moloni_status = 'invoiced', moloni_doc_id = ?, updated_at = ? WHERE id = ?")
      .run(String(created.document_id || ""), db.now(), order.id);
    return { status: "invoiced", document_id: created.document_id };
  } catch (err) {
    console.error("[moloni]", err.message);
    db.db
      .prepare("UPDATE orders SET moloni_status = 'error', updated_at = ? WHERE id = ?")
      .run(db.now(), order.id);
    return { status: "error", error: err.message };
  }
}

module.exports = { configured, createInvoiceForOrder, moloniCall };
