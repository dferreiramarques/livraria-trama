/* Chat anónimo #trama - pre + ASCII puro, polling de 3s */
(function () {
  const log = document.getElementById("irc-log");
  const users = document.getElementById("irc-users");
  const nickInput = document.getElementById("irc-nick");
  const msgInput = document.getElementById("irc-mensagem");
  const btn = document.getElementById("irc-enviar");
  const estado = document.getElementById("irc-estado");
  if (!log || !msgInput) return;

  let lastId = 0;
  let nick = localStorage.getItem("trama-nick") || "";

  function esc(s) {
    return s.replace(/[^ -~\n\t]/g, "?"); // so ASCII, no <pre>
  }
  function stamp(ts) {
    const d = new Date(ts);
    return "[" + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + "]";
  }
  /* o buffer nao faz scroll: quando passa o limite de linhas, corta-se por cima */
  const MAX_LINES = 26;
  function push(line) {
    log.textContent += esc(line) + "\n";
    const lines = log.textContent.split("\n");
    while (lines.length > MAX_LINES) lines.shift();
    log.textContent = lines.join("\n");
  }

  async function poll() {
    try {
      const res = await fetch("/api/chat/list?since=" + lastId);
      const data = await res.json();
      data.messages.forEach((m) => {
        const who = m.nick === "trama" ? "* bot" : "<" + m.nick + ">";
        push(stamp(m.created_at) + " " + who + " " + m.body);
      });
      estado.textContent = "ligado a #trama - " + data.online + " anonimos online (segundo o bot, nada seria)";
      users.textContent = "* trama (bot)\n" + (data.seedNicks || []).join("\n") + "\n";
    } catch {
      estado.textContent = "ligacao caiu - a tentar de novo ...";
    }
  }

  async function send() {
    const body = msgInput.value.trim();
    const who = (nickInput.value.trim() || nick);
    if (!who || who.length < 2) { msgInput.placeholder = "primeiro nomes um nick no campo a esquerda."; return; }
    localStorage.setItem("trama-nick", who);
    nick = who;
    if (!body) return;
    msgInput.value = "";
    try {
      const res = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nick: who, body }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        estado.textContent = "x " + (data.error || "falhou o envio");
      }
      await poll();
    } catch {
      estado.textContent = "x rede em chamada perdida - tenta logo a seguir.";
    }
  }

  btn.addEventListener("click", send);
  msgInput.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
  nickInput.value = nick;
  poll();
  setInterval(poll, 3000);
})();
