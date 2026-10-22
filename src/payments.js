"use strict";
const db = require("./db");

let stripeClient = null;
function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!stripeClient) stripeClient = require("stripe")(process.env.STRIPE_SECRET_KEY);
  return stripeClient;
}

function isConfigured() {
  return Boolean(getStripe());
}

/**
 * Cria uma sessão Stripe Checkout (cartão + Multibanco/MB WAY quando disponível em PT).
 * episode: order já criada na BD com items.
 */
async function createCheckout(order, items) {
  const stripe = getStripe();
  if (!stripe) return null;
  const lineItems = [
    ...items.map((it) => ({
      quantity: it.qty,
      price_data: {
        currency: "eur",
        unit_amount: it.unit_price_cents,
        product_data: { name: it.title },
      },
    })),
    ...(order.shipping_cents > 0
      ? [{
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: order.shipping_cents,
            product_data: { name: "Envio" },
          },
        }]
      : []),
  ];
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    locale: "pt",
    line_items: lineItems,
    client_reference_id: String(order.id),
    metadata: { order_code: order.code },
    customer_email: order.email || undefined,
    success_url: `${process.env.BASE_URL || "http://localhost:3000"}/encomenda/${order.code}?pago=1`,
    cancel_url: `${process.env.BASE_URL || "http://localhost:3000"}/encomenda/${order.code}?cancelado=1`,
  });
  return session;
}

/** Idempotente: verifica a sessão e marca pago se sucedido. */
async function confirmSession(orderRow) {
  const stripe = getStripe();
  if (!stripe || !orderRow.stripe_session_id) return false;
  const session = await stripe.checkout.sessions.retrieve(orderRow.stripe_session_id);
  if (session.payment_status === "paid") {
    db.db
      .prepare("UPDATE orders SET payment_status = 'paid', status = CASE WHEN status = 'new' THEN 'confirmed' ELSE status END, updated_at = ? WHERE id = ?")
      .run(db.now(), orderRow.id);
    return true;
  }
  return false;
}

module.exports = { getStripe, isConfigured, createCheckout, confirmSession };
