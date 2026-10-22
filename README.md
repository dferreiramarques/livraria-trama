# Livraria Trama — site + CMS

Livros, arte & al. · Rua dos Bragas, 32, Porto
Cultura contemporânea · filosofia · comics

Stack: **Node 22 + Express + SQLite (node:sqlite, sem dependências nativas) + EJS**.
Positivo para um VPS barato (Hetzner, contabo.pt, Lightsail) com nginx/Caddy.

---

## Arrancar em 60 segundos

    npm install
    cp .env.example .env     # e edita as chaves
    npm run seed             # (opcional) dados de demonstração
    npm start

Na primeira corrida cria-se um utilizador admin (a password sai na consola).
Entra na `/admin`, vai a **Definições**, muda a password.

---

## O que o sistema cobre

### Página pública
- **Search bar central** — livro, autor, editora, ISBN e categoria, com sugestões
  em tempo real (`/api/search`). Resultados em `/pesquisa`, ficha do livro permite
  juntar ao cesto.
- **Flow do cesto, simplificado** — meteorito-cesto em localStorage; checkout com
  nome/email/NIF, recolha na loja ou envio CTT (com custo e descontinhe grátis),
  pagamento via Stripe, transferência (IBAN/MB WAY nas Definições) ou na loja.
  Encomenda entra na BD **antes** do pagamento. A página `/encomenda/T-XXXXXX`
  mostra estado, pagamento e porta de reentrada para a Stripe.
- **Feed de novidades** — últimos posts do Instagram via Graph API com cache de
  30 min. Se não estiver ligado, entra entrada manual do CMS.
- **Randomizer** — `/surpresa` sorteia um livro à sorte de tudo o que está em
  prateleira (botão "rodar outra vez").
- **Agenda** (`/agenda`) e **Arquivo** (`/arquivo`) — eventos e exposições passam
  de "em curso" para "portfolio do que aconteceu" automaticamente pela data de fim.
- **Chat anónimo #trama** — estilo mIRC 2000: nick espontâneo, timestamps,
  faulhar-sistema do bot, MSP-estilizado. Anti-spam por hash de rede + intervalo.
  Moderação no CMS (esconder/apagar).

### CMS (`/admin`) — para os donos, sem terminal
- **Início** — nota do estado: encomendas a tratar, pagas 30d, stock baixo.
- **Encomendas** — lista filtrável, folha por encomenda: itens, cliente, morada.
  Ações: *marcar pago (+ fatura Moloni)*, *confirmar*, *enviada/pronta para
  recolha (avisa cliente)*, *entregue*, *cancelar (repõe stock)*, nota interna,
  re-emitir fatura.
- **Livros** — CRUD completo, titulares +/− de stock inline, botão **saída**
  (marcar vendido → sai do catálogo público) e **voltar** (re-assenta).
  ★ marca a "recentemente no catálogo".
- **Eventos & Exposições** — com imagem, descrição, hora de início/fim, publish/unpublish.
- **Novidades** — espelho do feed do IG + entradas manuais live.
- **Chat** — moderação.
- **Definições** — loja (morada/horário/email), portes, IBAN/MB WAY, Instagram
  (token long-lived + user id), Moloni (client id/secret/company/customer/product/VAT),
  mensagem do chat, mudar password própria.

### Emails automáticos (SMTP)
Sem SMTP configurado, os emails saem impressos na consola do servidor (`[mail:console]`),
para desenvolvimento. Com SMTP vão de verdade:
1. Encomenda recebida (cliente, com resumo e instrução de pagamento);
2. Encomenda enviada (state `shipped`);
3. Pronta para recolha na loja (state `ready`);
4. Cancelada.

Em `.env`: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`.
Vai bem com um SMTP gratuito tipo Brevo/Elastic EmailMailgun plano grátis.

### Pagamentos — Stripe
- Hospedado Stripe Checkout: **cartão, Multibanco, MB WAY** (disponíveis em PT).
- Chaves: `STRIPE_SECRET_KEY` (+ `STRIPE_WEBHOOK_SECRET` se quiseres confirmação
  server-side em `/api/stripe/webhook`).
- No checkout público: `stripe` (online), `transfer` (IBAN nas Definições), `store`
  (paga na recolha — só com pick-up).

### Faturação — Moloni (plano grátis)
Em Moloni → Developers/API → cria uma API client e cola nas Definições do CMS
(client id, client secret, username, company id, customer id "Clientes Livraria",
product id genérico, vat id). Quando uma encomenda é **marcada como paga**, o CMS
tenta emitir a fatura-simplificada e guarda o `document_id`; se falhar, fica
marcado `error` na folha da encomenda (não bloqueia a operação).
> Endpoint por defeito: `https://api.moloni.pt/v1/…` — ajustar `MOLONI_TOKEN_URL`/
> `MOLONI_API_BASE` em .env se a docs indicarem o contrário; a integração de
> falhas é tolerante (aguenta bem até confirmarem os IDs de produto/cliente).

### Instagram — Graph API
Já é preciso **conta profissional** no Instagram:
1. Meta App (tipo Business) → Instagram → API setup with Instagram login →
   **Generate token** (long-lived, 60 dias).
2. In `/admin/definicoes`: cola o **access token** e o **user id**
   (`GET graph.instagram.com/v26.0/me?fields=user_id,username&access_token=…`).
3. Quando o token expirar, em `/admin/novidades?refresh=1` tenta renovar
   (`refresh_access_token`) — pinta-o de novo se os 60 dias passarem.

---

## Deploy rápido (VPS Ubuntu)

    sudo apt install -y nodejs npm nginx
    git clone <repositório> /srv/trama && cd /srv/trama
    npm ci && npm run seed        # sem seed em produção
    NODE_ENV=production
    npm i -g pm2 && pm2 start server.js --name trama && pm2 save

nginx (proxy_reverse):

    server {
      server_name livrariatrama.com www.livrariatrama.com;
      location / { proxy_pass http://127.0.0.1:3000;
                   proxy_set_header X-Forwarded-Proto $scheme; }
    }

+ `TRUST_PROXY=1` no `.env` para os cookies Make it: certificado `certbot --nginx`.

---

## Estrutura

    server.js               arranque express, sessões, rotas
    src/
      db.js                 SQLite (node:sqlite), schema, settings
      auth.js               admin (scrypt), requireAdmin
      mail.js               SMTP + templates PT de notificação
      payments.js           Stripe Checkout + confirm
      moloni.js             token + fatura-simplificada
      instagram.js          Graph API + cache
      seed.js               dados de demo (npm run seed)
    routes/
      public.js  páginas públicas + criar encomenda
      api.js     search/cart/chat + webhook Stripe
      admin.js   CMS completo
    views/       EJS (público + admin), partials
    public/      css (rosa velho/creme), js (cart, chat), logo

## Segurança a lembrar
- `SESSION_SECRET` não aleatória por boot (fixa no .env) para não invalidar sessões.
- 1ª password de admin: sai na consola na 1.ª corrida — troca já em Definições.
- `.env` nunca em git. `data/` (bd) também não.
- Antes de abrir ao mundo, adicionares HTTPS (certbot) e Stripe em modo *live*.

---

## Deploy do prototipo na Render (gratuito)

1. Repo no GitHub (privado serve).
2. Em render.com: **New - Blueprint** e escolhe o repo — o ender.yaml trata do resto (Node 22, 
pm install, 
pm start, SESSION_SECRET aleatoria).
3. No dashboard, preenche os valores sync: false:
   - BASE_URL = o dominio que a Render der ex. https://trama-demo.onrender.com
   - ADMIN_PASSWORD = password do CMS (/admin, utilizador 	rama)
   - STRIPE_SECRET_KEY so se quiseres checkout online na demo (sk_test_ serve)
4. **Disco efemero**: a BD e as imagens voltam ao estado do repo a cada deploy — para demo e desejado (conteudo fixo); encomendas/imagens novas morrem no restart. Para persistencia real: Railway/Hetzner com volume.

A instancia gratuita adormece apos ~15 min sem visitas; o primeiro acesso demora \~30 s.
