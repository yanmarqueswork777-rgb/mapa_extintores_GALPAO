/* ============================================================
   FireMap — script.js  (multi-galpão)
   ============================================================ */

/* ── ESTRUTURA DE DADOS ──
   galpoes:  { id: { nome, imagem } }
   dados:    { galpaoId: { extId: { tipo, validade, setor } } }
   posicoes: { galpaoId: { extId: { top, left } } }
   ─────────────────────────────────────────────────────────── */

let galpoes = {
  "A": { nome: "Galpão A", imagem: "imagens/galpaoA.png" }
};
let dados = {
  "A": {
    "1": { tipo: "Pó Químico ABC", validade: "2026-05-10", setor: "Porta Principal" },
    "2": { tipo: "CO₂",            validade: "2026-03-25", setor: "Corredor B" }
  }
};
let posicoes = {
  "A": {
    "1": { top: "100px", left: "200px" },
    "2": { top: "250px", left: "400px" }
  }
};

let galpaoAtivo  = "A";
let modoAtual    = null;   // null | "mover" | "colocar"
let idAtivo      = null;
let viewAtual    = "mapa";
let pz           = null;
let pinFantasma  = null;
let novoExtintorDados = null;

/* Map de refs DOM por galpão: galpaoId → Map(extId → el) */
const pontoElsPorGalpao = {};

function getPontoEls() {
  if (!pontoElsPorGalpao[galpaoAtivo]) pontoElsPorGalpao[galpaoAtivo] = new Map();
  return pontoElsPorGalpao[galpaoAtivo];
}

/* ── PERSISTÊNCIA ── */
let _saveTimer = null;
function salvarStorage() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => _escreveStorage(), 400);
}
function salvarStorageImediato() {
  clearTimeout(_saveTimer);
  _escreveStorage();
}
function _escreveStorage() {
  localStorage.setItem("fm_galpoes",  JSON.stringify(galpoes));
  localStorage.setItem("fm_dados",    JSON.stringify(dados));
  localStorage.setItem("fm_posicoes", JSON.stringify(posicoes));
}
function carregarStorage() {
  try {
    const g = localStorage.getItem("fm_galpoes");
    const d = localStorage.getItem("fm_dados");
    const p = localStorage.getItem("fm_posicoes");
    if (g) galpoes  = JSON.parse(g);
    if (d) dados    = JSON.parse(d);
    if (p) posicoes = JSON.parse(p);
    // Garante que o galpão ativo existe
    if (!galpoes[galpaoAtivo]) galpaoAtivo = Object.keys(galpoes)[0];
    // Garante estrutura para cada galpão
    Object.keys(galpoes).forEach(gid => {
      if (!dados[gid])    dados[gid]    = {};
      if (!posicoes[gid]) posicoes[gid] = {};
    });
  } catch(e) {}
}

/* ── STATUS ── */
function calcularStatus(val) {
  if (!val) return "vermelho";
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const diff = Math.ceil((new Date(val + "T00:00:00") - hoje) / 86400000);
  return diff < 0 ? "vermelho" : diff <= 30 ? "amarelo" : "verde";
}
function diasRestantes(val) {
  if (!val) return -999;
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  return Math.ceil((new Date(val + "T00:00:00") - hoje) / 86400000);
}
function diasLabel(val) {
  const d = diasRestantes(val);
  if (d === -999) return "Sem validade";
  if (d < 0)      return `${Math.abs(d)} dias vencido`;
  if (d === 0)    return "Vence hoje!";
  return `${d} dias restantes`;
}
function statusLabel(s) { return { verde:"Em dia", amarelo:"Vencendo em breve", vermelho:"Vencido" }[s]; }
function statusIcon(s)  { return { verde:"✓", amarelo:"⚠", vermelho:"✕" }[s]; }

/* ── STATUS GERAL DE UM GALPÃO (para o dot da aba) ── */
function statusGalpao(gid) {
  const ext = dados[gid] || {};
  const ids = Object.keys(ext);
  if (!ids.length) return "neutro";
  let temVermelho = false, temAmarelo = false;
  ids.forEach(id => {
    const s = calcularStatus(ext[id].validade);
    if (s === "vermelho") temVermelho = true;
    else if (s === "amarelo") temAmarelo = true;
  });
  return temVermelho ? "vermelho" : temAmarelo ? "amarelo" : "verde";
}

/* ── STATS ── */
function atualizarStats() {
  const ext = dados[galpaoAtivo] || {};
  const ids = Object.keys(ext);
  let ok = 0, warn = 0, exp = 0;
  ids.forEach(id => {
    const s = calcularStatus(ext[id].validade);
    if (s === "verde") ok++;
    else if (s === "amarelo") warn++;
    else exp++;
  });
  document.getElementById("statTotal").textContent = ids.length;
  document.getElementById("statOk").textContent    = ok;
  document.getElementById("statWarn").textContent  = warn;
  document.getElementById("statExp").textContent   = exp;
  document.getElementById("statsLabel").textContent = galpoes[galpaoAtivo]?.nome || galpaoAtivo;
}

/* ════════════════════════════════════════
   ABAS DE GALPÃO
   ════════════════════════════════════════ */
function renderizarAbas() {
  const list = document.getElementById("tabsList");
  list.innerHTML = Object.keys(galpoes).map(gid => {
    const g      = galpoes[gid];
    const status = statusGalpao(gid);
    const ativo  = gid === galpaoAtivo ? "active" : "";
    const qtd    = Object.keys(dados[gid] || {}).length;
    return `
      <div class="tab ${ativo}" onclick="trocarGalpao('${gid}')">
        <span class="tab-dot ${status}"></span>
        <span class="tab-nome">${g.nome}</span>
        <span style="font-size:10px;color:var(--text3);font-weight:500">${qtd}</span>
        <span class="tab-action" onclick="abrirRenomearGalpao(event,'${gid}')" title="Renomear galpão">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </span>
        <span class="tab-close" onclick="pedirExcluirGalpao(event,'${gid}')" title="Excluir galpão">✕</span>
      </div>`;
  }).join("");
}

function trocarGalpao(gid) {
  if (gid === galpaoAtivo) return;
  sairModoEdicaoSilencioso();
  fecharPainel();
  galpaoAtivo = gid;
  renderizarAbas();
  carregarMapa();
  renderizarPontos();
  atualizarStats();
  if (viewAtual === "lista") renderizarLista();
  document.getElementById("viewSub").textContent = subtitleAtual();
}

function subtitleAtual() {
  const qtd = Object.keys(dados[galpaoAtivo] || {}).length;
  return viewAtual === "mapa"
    ? `${galpoes[galpaoAtivo]?.nome} · clique num extintor para detalhes`
    : `${qtd} extintor${qtd !== 1 ? "es" : ""} cadastrado${qtd !== 1 ? "s" : ""}`;
}

/* ── CARREGAR IMAGEM DO MAPA ── */
function carregarMapa() {
  const img = document.getElementById("mapaImg");
  const src = galpoes[galpaoAtivo]?.imagem || "";
  if (src) {
    img.src = src;
    img.classList.remove("no-image");
    img.onerror = () => { img.src = ""; img.classList.add("no-image"); };
  } else {
    img.src = "";
    img.classList.add("no-image");
  }
  if (pz) pz.reset();
}

/* ════════════════════════════════════════
   GERENCIAR GALPÕES
   ════════════════════════════════════════ */
function abrirModalGalpao() {
  document.getElementById("nomeGalpao").value   = "";
  document.getElementById("imagemGalpao").value = "";
  document.getElementById("modalGalpao").classList.remove("hidden");
  setTimeout(() => document.getElementById("nomeGalpao").focus(), 100);
}
function fecharModalGalpao() {
  document.getElementById("modalGalpao").classList.add("hidden");
}
function confirmarNovoGalpao() {
  const nome   = document.getElementById("nomeGalpao").value.trim();
  const imagem = document.getElementById("imagemGalpao").value.trim();
  if (!nome) { toast("Informe o nome do galpão!", "err"); return; }

  // Gera um ID único: letra ou número não usado
  const ids = Object.keys(galpoes);
  let novoId = String.fromCharCode(65 + ids.length); // A, B, C...
  while (galpoes[novoId]) novoId += "_";

  galpoes[novoId]  = { nome, imagem: imagem || "" };
  dados[novoId]    = {};
  posicoes[novoId] = {};

  fecharModalGalpao();
  salvarStorageImediato();
  trocarGalpao(novoId);
  renderizarAbas();
  toast(`${nome} criado!`, "ok");
}

let _galpaoParaExcluir = null;
function pedirExcluirGalpao(e, gid) {
  e.stopPropagation();
  _galpaoParaExcluir = gid;
  const nome = galpoes[gid]?.nome || gid;
  const qtd  = Object.keys(dados[gid] || {}).length;
  document.getElementById("textoExcluirGalpao").innerHTML =
    `Deseja excluir <strong>${nome}</strong>?` +
    (qtd > 0 ? `<br><br>Isso removerá também os <strong>${qtd} extintor${qtd > 1 ? "es" : ""}</strong> cadastrados nele.` : "");
  document.getElementById("modalExcluirGalpao").classList.remove("hidden");
}
function fecharModalExcluirGalpao() {
  document.getElementById("modalExcluirGalpao").classList.add("hidden");
  _galpaoParaExcluir = null;
}
function confirmarExcluirGalpao() {
  const gid = _galpaoParaExcluir;
  if (!gid) return;
  if (Object.keys(galpoes).length === 1) {
    toast("Não é possível excluir o único galpão.", "err");
    fecharModalExcluirGalpao(); return;
  }
  const nome = galpoes[gid]?.nome || gid;
  delete galpoes[gid];
  delete dados[gid];
  delete posicoes[gid];
  delete pontoElsPorGalpao[gid];
  fecharModalExcluirGalpao();
  salvarStorageImediato();
  if (galpaoAtivo === gid) {
    galpaoAtivo = Object.keys(galpoes)[0];
    carregarMapa();
  }
  renderizarAbas();
  renderizarPontos();
  atualizarStats();
  toast(`${nome} excluído`, "warn");
}

/* ════════════════════════════════════════
   PONTOS
   ════════════════════════════════════════ */
function renderizarPontos() {
  const pontoEls = getPontoEls();
  pontoEls.forEach(el => el.remove());
  pontoEls.clear();
  const ext = dados[galpaoAtivo] || {};
  Object.keys(ext).forEach(id => renderPonto(id));
  atualizarStats();
}

function renderPonto(id) {
  const ext    = dados[galpaoAtivo]?.[id];
  const pos    = posicoes[galpaoAtivo]?.[id];
  if (!ext || !pos) return;
  const status = calcularStatus(ext.validade);
  const dias   = diasRestantes(ext.validade);
  const pontoEls = getPontoEls();

  const div = document.createElement("div");
  div.id        = "p" + id;
  div.className = `ponto ${status}${idAtivo == id ? " selecionado" : ""}`;
  div.style.cssText = `top:${pos.top}; left:${pos.left}; z-index:20;`;

  const tt = document.createElement("div");
  tt.className   = "ttip";
  tt.textContent = `#${id} — ${ext.tipo} · ${dias < 0 ? "VENCIDO" : dias === 0 ? "Hoje!" : dias + "d"}`;
  div.appendChild(tt);

  div.addEventListener("click", e => {
    if (modoAtual) return;
    e.stopPropagation();
    abrirPainel(id);
  });

  div.addEventListener("mousedown", e => {
    if (modoAtual !== "mover") return;
    e.stopPropagation(); e.preventDefault();
    iniciarDrag(div, id, e);
  });

  document.getElementById("mapa").appendChild(div);
  pontoEls.set(String(id), div);
}

function atualizarPonto(id) {
  const el = getPontoEls().get(String(id));
  if (!el) return;
  const ext    = dados[galpaoAtivo]?.[id];
  const status = calcularStatus(ext?.validade);
  const dias   = diasRestantes(ext?.validade);
  el.className = `ponto ${status}${idAtivo == id ? " selecionado" : ""}`;
  const tt = el.querySelector(".ttip");
  if (tt) tt.textContent = `#${id} — ${ext?.tipo} · ${dias < 0 ? "VENCIDO" : dias === 0 ? "Hoje!" : dias + "d"}`;
}

/* ── DRAG (RAF + cache rect) ── */
function iniciarDrag(div, id, e) {
  const rect = document.getElementById("mapa").getBoundingClientRect();
  const ox   = e.clientX - rect.left - parseFloat(div.style.left);
  const oy   = e.clientY - rect.top  - parseFloat(div.style.top);
  let pendX  = parseFloat(div.style.left), pendY = parseFloat(div.style.top);
  let rafId  = null, moveu = false;
  div.style.willChange = "left, top";
  div.style.opacity    = "0.8";
  document.body.style.userSelect = "none";

  function onMove(ev) {
    pendX = ev.clientX - rect.left - ox;
    pendY = ev.clientY - rect.top  - oy;
    moveu = true;
    if (!rafId) rafId = requestAnimationFrame(() => {
      div.style.left = pendX + "px";
      div.style.top  = pendY + "px";
      rafId = null;
    });
  }
  function onUp() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    div.style.willChange = ""; div.style.opacity = "1";
    document.body.style.userSelect = "";
    if (moveu) {
      posicoes[galpaoAtivo][id] = { top: div.style.top, left: div.style.left };
      salvarStorage();
      toast("Posição salva", "ok");
    }
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  }
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

/* ── COLOCAR EXTINTOR ── */
document.getElementById("mapa").addEventListener("click", e => {
  if (modoAtual !== "colocar" || !novoExtintorDados) return;
  if (e.target.closest(".ponto:not(.fantasma)")) return;
  const rect = document.getElementById("mapa").getBoundingClientRect();
  const x    = Math.round(e.clientX - rect.left);
  const y    = Math.round(e.clientY - rect.top);

  const id = novoExtintorDados.id;
  const { id: _k, ...rest } = novoExtintorDados;
  if (!dados[galpaoAtivo])    dados[galpaoAtivo]    = {};
  if (!posicoes[galpaoAtivo]) posicoes[galpaoAtivo] = {};
  dados[galpaoAtivo][id]    = rest;
  posicoes[galpaoAtivo][id] = { top: y + "px", left: x + "px" };
  novoExtintorDados = null;

  if (pinFantasma) { pinFantasma.remove(); pinFantasma = null; }
  salvarStorageImediato();
  renderPonto(id);
  atualizarStats();
  renderizarAbas();

  modoAtual = "mover";
  document.getElementById("mapaContainer").classList.remove("modo-adicionar");
  document.getElementById("modoEdBadgeTexto").textContent = "Modo mover — arraste os extintores";
  toast(`Extintor #${id} posicionado!`, "ok");
});

/* ── PIN FANTASMA ── */
function criarPinFantasma() {
  if (pinFantasma) pinFantasma.remove();
  pinFantasma = document.createElement("div");
  pinFantasma.className = "ponto fantasma verde";
  Object.assign(pinFantasma.style, { zIndex:"100", pointerEvents:"none", position:"absolute", display:"none", willChange:"left,top" });
  document.getElementById("mapa").appendChild(pinFantasma);
}
let _pinRaf = null;
document.getElementById("mapaContainer").addEventListener("mousemove", e => {
  if (modoAtual !== "colocar" || !pinFantasma) return;
  const rect = document.getElementById("mapa").getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  if (!_pinRaf) _pinRaf = requestAnimationFrame(() => {
    pinFantasma.style.display = "block";
    pinFantasma.style.left    = x + "px";
    pinFantasma.style.top     = y + "px";
    _pinRaf = null;
  });
});
document.getElementById("mapaContainer").addEventListener("mouseleave", () => {
  if (pinFantasma) pinFantasma.style.display = "none";
});

/* ════════════════════════════════════════
   MODO EDIÇÃO
   ════════════════════════════════════════ */
function toggleEdicao() {
  if (modoAtual) { sairModoEdicao(); return; }
  document.getElementById("modalEdicao").classList.remove("hidden");
}
function fecharModalEdicao() {
  document.getElementById("modalEdicao").classList.add("hidden");
}
function entrarModoMover() {
  fecharModalEdicao();
  modoAtual = "mover";
  destruirPanzoom();
  document.getElementById("btnEdicao").classList.add("ativo");
  document.getElementById("modoEdBadge").classList.remove("hidden");
  document.getElementById("modoEdBadgeTexto").textContent = "Modo mover — arraste os extintores";
  fecharPainel();
  toast("Modo mover ativo", "warn");
}
function entrarModoCriar() {
  fecharModalEdicao();
  const sugestao = proximoIdDisponivel();
  const input    = document.getElementById("novoId");
  input.value    = sugestao;
  validarId(sugestao);
  document.getElementById("modalCadastro").classList.remove("hidden");
  setTimeout(() => input.focus(), 100);
}
function sairModoEdicao() {
  sairModoEdicaoSilencioso();
  toast("Modo edição desativado", "ok");
}
function sairModoEdicaoSilencioso() {
  modoAtual = null;
  novoExtintorDados = null;
  if (pinFantasma) { pinFantasma.remove(); pinFantasma = null; }
  criarPanzoom();
  document.getElementById("btnEdicao").classList.remove("ativo");
  document.getElementById("modoEdBadge").classList.add("hidden");
  document.getElementById("mapaContainer").classList.remove("modo-adicionar");
}

/* ── ID CUSTOMIZADO ── */
function proximoIdDisponivel() {
  const usados = new Set(Object.keys(dados[galpaoAtivo] || {}));
  let n = 1;
  while (usados.has(String(n))) n++;
  return String(n);
}
function idJaExiste(val) {
  return Object.keys(dados[galpaoAtivo] || {}).includes(String(val).trim());
}
function validarId(val) {
  const wrap = document.getElementById("novoId").parentElement;
  const fb   = document.getElementById("idFeedback");
  const btn  = document.getElementById("btnConfirmarCadastro");
  const v    = val.trim();
  if (!v) { wrap.classList.remove("id-ok","id-erro"); fb.textContent = ""; fb.className = "id-feedback"; btn.disabled = false; return; }
  if (idJaExiste(v)) {
    wrap.classList.add("id-erro"); wrap.classList.remove("id-ok");
    fb.textContent = `#${v} já existe neste galpão`; fb.className = "id-feedback erro"; btn.disabled = true;
  } else {
    wrap.classList.add("id-ok"); wrap.classList.remove("id-erro");
    fb.textContent = `#${v} disponível`; fb.className = "id-feedback ok"; btn.disabled = false;
  }
}
function usarProximoId() {
  const s = proximoIdDisponivel();
  document.getElementById("novoId").value = s;
  validarId(s);
  document.getElementById("novoId").focus();
}
function confirmarCadastro() {
  const idRaw    = document.getElementById("novoId").value.trim();
  const tipo     = document.getElementById("novoTipo").value;
  const validade = document.getElementById("novaValidade").value;
  const setor    = document.getElementById("novoSetor").value.trim();
  if (!idRaw)    { toast("Informe a identificação!", "err"); return; }
  if (!validade) { toast("Informe a validade!", "err"); return; }
  if (idJaExiste(idRaw)) { toast(`#${idRaw} já existe!`, "err"); return; }

  novoExtintorDados = { id: idRaw, tipo, validade, setor: setor || galpoes[galpaoAtivo]?.nome || "Galpão" };
  document.getElementById("modalCadastro").classList.add("hidden");
  document.getElementById("novoId").value       = "";
  document.getElementById("novoSetor").value    = "";
  document.getElementById("novaValidade").value = "";
  document.getElementById("idFeedback").textContent = "";
  document.getElementById("novoId").parentElement.classList.remove("id-ok","id-erro");
  document.getElementById("btnConfirmarCadastro").disabled = false;

  modoAtual = "colocar";
  destruirPanzoom();
  document.getElementById("btnEdicao").classList.add("ativo");
  document.getElementById("modoEdBadge").classList.remove("hidden");
  document.getElementById("modoEdBadgeTexto").textContent = "Clique no mapa para posicionar";
  document.getElementById("mapaContainer").classList.add("modo-adicionar");
  criarPinFantasma();
  toast("Clique no mapa para posicionar o extintor", "warn");
}
function cancelarCadastro() {
  document.getElementById("modalCadastro").classList.add("hidden");
  novoExtintorDados = null;
}

/* ════════════════════════════════════════
   PAINEL DE DETALHES
   ════════════════════════════════════════ */
function abrirPainel(id) {
  if (idAtivo !== null) {
    const prev = getPontoEls().get(String(idAtivo));
    if (prev) prev.classList.remove("selecionado");
  }
  idAtivo = id;
  const el = getPontoEls().get(String(id));
  if (el) el.classList.add("selecionado");

  const ext    = dados[galpaoAtivo]?.[id];
  const status = calcularStatus(ext?.validade);
  document.getElementById("dpId").textContent  = `EXTINTOR #${id}`;
  document.getElementById("dpNome").textContent = ext?.tipo || "—";
  const bar = document.getElementById("dpStatusBar");
  bar.className = `dp-status-bar s-${status}`;
  document.getElementById("dpStatusIcon").textContent = statusIcon(status);
  document.getElementById("dpStatusText").textContent = statusLabel(status);
  document.getElementById("dpDias").textContent       = ext?.validade ? diasLabel(ext.validade) : "—";
  document.getElementById("editSetor").value    = ext?.setor    || "";
  document.getElementById("editTipo").value     = ext?.tipo     || "Pó Químico ABC";
  document.getElementById("editValidade").value = ext?.validade || "";
  document.getElementById("detailPanel").classList.remove("hidden");
}
function fecharPainel() {
  if (idAtivo !== null) {
    const el = getPontoEls().get(String(idAtivo));
    if (el) el.classList.remove("selecionado");
  }
  idAtivo = null;
  document.getElementById("detailPanel").classList.add("hidden");
}
function salvarEdicao() {
  if (!idAtivo) return;
  const val = document.getElementById("editValidade").value;
  if (!val) { toast("Informe a validade!", "err"); return; }
  dados[galpaoAtivo][idAtivo].tipo     = document.getElementById("editTipo").value;
  dados[galpaoAtivo][idAtivo].validade = val;
  dados[galpaoAtivo][idAtivo].setor    = document.getElementById("editSetor").value.trim() || dados[galpaoAtivo][idAtivo].setor;
  salvarStorageImediato();
  atualizarPonto(idAtivo);
  atualizarStats();
  renderizarAbas();
  abrirPainel(idAtivo);
  if (viewAtual === "lista") renderizarLista();
  toast("Extintor atualizado!", "ok");
}
function trocarValidade() {
  if (!idAtivo) return;
  const nova = new Date(); nova.setFullYear(nova.getFullYear() + 1);
  dados[galpaoAtivo][idAtivo].validade = nova.toISOString().split("T")[0];
  salvarStorageImediato();
  atualizarPonto(idAtivo);
  atualizarStats();
  renderizarAbas();
  abrirPainel(idAtivo);
  if (viewAtual === "lista") renderizarLista();
  toast("Recarga registrada! Válido por mais 1 ano.", "ok");
}
function removerExtintor() {
  if (!idAtivo) return;
  if (!confirm(`Remover o Extintor #${idAtivo} de ${galpoes[galpaoAtivo]?.nome}?`)) return;
  const id = idAtivo;
  fecharPainel();
  const el = getPontoEls().get(String(id));
  if (el) el.remove();
  getPontoEls().delete(String(id));
  delete dados[galpaoAtivo][id];
  delete posicoes[galpaoAtivo][id];
  salvarStorageImediato();
  atualizarStats();
  renderizarAbas();
  if (viewAtual === "lista") renderizarLista();
  toast(`Extintor #${id} removido`, "warn");
}

/* ════════════════════════════════════════
   VIEWS / LISTA
   ════════════════════════════════════════ */
function setView(v) {
  viewAtual = v;
  document.getElementById("viewMapa").classList.toggle("hidden",  v !== "mapa");
  document.getElementById("viewLista").classList.toggle("hidden", v !== "lista");
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  event?.currentTarget?.classList.add("active");
  document.getElementById("viewTitle").textContent = v === "mapa" ? "Mapa de Extintores" : "Lista de Extintores";
  document.getElementById("viewSub").textContent   = subtitleAtual();
  if (v === "lista") renderizarLista();
}

let _listaTimer = null;
function filtrarLista(v) {
  clearTimeout(_listaTimer);
  _listaTimer = setTimeout(() => { if (viewAtual === "lista") renderizarLista(v); }, 150);
}

function renderizarLista(filtro = "") {
  const c   = document.getElementById("listaContainer");
  const ext = dados[galpaoAtivo] || {};
  const ids = Object.keys(ext).filter(id => {
    if (!filtro) return true;
    const f = filtro.toLowerCase();
    return String(id).includes(f) || ext[id].tipo.toLowerCase().includes(f) || ext[id].setor.toLowerCase().includes(f);
  });
  if (!ids.length) { c.innerHTML = `<div style="color:var(--text3);font-size:14px;padding:20px">Nenhum extintor encontrado.</div>`; return; }
  c.innerHTML = ids.sort((a,b)=>isNaN(a)||isNaN(b)?a.localeCompare(b):+a-+b).map(id => {
    const e = ext[id]; const status = calcularStatus(e.validade);
    const d = e.validade ? diasRestantes(e.validade) : null;
    const dTx = d===null?"—":d<0?`${Math.abs(d)}d vencido`:d===0?"Hoje!":`${d}d`;
    return `<div class="lista-card ${status}" onclick="abrirPainelLista('${id}')">
      <div class="lc-header"><span class="lc-id">#${id}</span><span class="lc-badge ${status}">${statusLabel(status)}</span></div>
      <div class="lc-tipo">${e.tipo}</div><div class="lc-setor">${e.setor}</div>
      <div class="lc-divider"></div>
      <div><span class="lc-validade">Val. ${e.validade||"—"}</span><span class="lc-dias ${status}">${dTx}</span></div>
    </div>`;
  }).join("");
}
function abrirPainelLista(id) {
  setView("mapa");
  document.querySelectorAll(".nav-item")[0].classList.add("active");
  document.querySelectorAll(".nav-item")[1].classList.remove("active");
  setTimeout(() => abrirPainel(id), 50);
}

/* ════════════════════════════════════════
   PANZOOM
   ════════════════════════════════════════ */
function criarPanzoom() {
  if (pz) return;
  pz = Panzoom(document.getElementById("mapa"), { maxScale:5, minScale:0.4, contain:"outside" });
}
function destruirPanzoom() { if (!pz) return; pz.destroy(); pz = null; }
function resetZoom() { if (pz) pz.reset(); }
document.getElementById("mapaContainer").addEventListener("wheel", e => { if (pz) pz.zoomWithWheel(e); });

/* ── TOAST ── */
function toast(msg, tipo = "") {
  const c = document.getElementById("toast-container");
  const el = document.createElement("div");
  el.className = `toast ${tipo}`; el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => { el.classList.add("fade-out"); setTimeout(() => el.remove(), 350); }, 3000);
}

/* ── EXPORTAR ── */
function exportarRelatorio() {
  const hoje = new Date().toLocaleDateString("pt-BR");
  let txt = `RELATÓRIO DE EXTINTORES — ${hoje}\n${"─".repeat(60)}\n\n`;
  Object.keys(galpoes).forEach(gid => {
    txt += `▶ ${galpoes[gid].nome}\n${"─".repeat(40)}\n`;
    const ext = dados[gid] || {};
    const ids = Object.keys(ext);
    if (!ids.length) { txt += "  Nenhum extintor cadastrado.\n\n"; return; }
    ids.sort((a,b)=>isNaN(a)||isNaN(b)?a.localeCompare(b):+a-+b).forEach(id => {
      const e = ext[id]; const s = calcularStatus(e.validade); const d = diasRestantes(e.validade);
      const sx = s==="verde"?"✓ EM DIA":s==="amarelo"?"⚠ VENCENDO":"✕ VENCIDO";
      const dTx = d>=0?`${d}d restantes`:`${Math.abs(d)}d vencido`;
      txt += `  #${String(id).padStart(3,"0")} | ${e.tipo.padEnd(18)} | ${e.setor.padEnd(18)} | Val: ${e.validade||"—"} | ${sx} (${dTx})\n`;
    });
    txt += "\n";
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([txt], { type:"text/plain;charset=utf-8" }));
  a.download = `extintores-${hoje.replace(/\//g,"-")}.txt`;
  a.click();
  toast("Relatório exportado!", "ok");
}

/* ════════════════════════════════════════
   RENOMEAR GALPÃO
   ════════════════════════════════════════ */
function abrirRenomearGalpao(e, gid) {
  e.stopPropagation();
  const nome = galpoes[gid]?.nome || "";
  document.getElementById("renomearGalpaoId").value    = gid;
  document.getElementById("renomearGalpaoNome").value  = nome;
  document.getElementById("renomearGalpaoImg").value   = galpoes[gid]?.imagem || "";
  document.getElementById("modalRenomear").classList.remove("hidden");
  setTimeout(() => {
    const input = document.getElementById("renomearGalpaoNome");
    input.focus();
    input.select();
  }, 100);
}
function fecharModalRenomear() {
  document.getElementById("modalRenomear").classList.add("hidden");
}
function confirmarRenomear() {
  const gid    = document.getElementById("renomearGalpaoId").value;
  const nome   = document.getElementById("renomearGalpaoNome").value.trim();
  const imagem = document.getElementById("renomearGalpaoImg").value.trim();
  if (!nome) { toast("Informe um nome!", "err"); return; }
  galpoes[gid].nome   = nome;
  galpoes[gid].imagem = imagem;
  fecharModalRenomear();
  salvarStorageImediato();
  // Se é o galpão ativo, recarrega a imagem caso tenha mudado
  if (gid === galpaoAtivo) carregarMapa();
  renderizarAbas();
  atualizarStats(); // atualiza o label do sidebar
  toast(`${nome} atualizado!`, "ok");
}

/* ════════════════════════════════════════
   INIT
   ════════════════════════════════════════ */
carregarStorage();
criarPanzoom();
renderizarAbas();
carregarMapa();
renderizarPontos();
document.getElementById("viewSub").textContent = subtitleAtual();
