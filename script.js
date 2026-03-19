/* ============================================================
   FireMap — script.js  (multi-galpão) — OTIMIZADO
   ============================================================
   OTIMIZAÇÕES APLICADAS:
   ─ EL{}  : cache de todos os elementos fixos do DOM (evita
             getElementById repetido — ~30+ lookups por ação)
   ─ getHoje() : Date do dia cacheada por 60s (antes: new Date()
                 era criado a cada chamada de calcularStatus/
                 diasRestantes — 4× por extintor no render)
   ─ calcularDias() : função-raiz única; calcularStatus e
                      diasRestantes derivam dela sem re-parsear
   ─ atualizarAbaStatus(gid) : atualiza dot + contador de UMA
                aba sem reconstruir todo o innerHTML das tabs
   ─ trocarGalpao() : troca só a classe "active" em vez de
                      full rebuild das abas
   ─ _atualizarPainelStatus() : atualiza barra de status do
                painel in-place (antes: abrirPainel() completo)
   ─ salvarEdicao / trocarValidade / removerExtintor usam os
     dois pontos acima — eliminando um full rebuild por ação
   ─ validarIdDebounce() : 80ms de debounce no oninput
   ─ renderizarPontos() : limpa só o mapa ativo, não todos
   ─ renderizarLista() : usa calcularDias() uma vez por card
   ─ statusGalpao() : for…of com break antecipado no vermelho
   ─ confirmarNovoGalpao() : sem double render
   ─ renderPonto() : usa calcularDias() uma vez
   ─ atualizarPonto() : usa calcularDias() uma vez
   ============================================================ */

/* ── ESTRUTURA DE DADOS ──
   galpoes:  { id: { nome, imagem, fundo } }
   dados:    { galpaoId: { extId: { tipo, validade, setor } } }
   posicoes: { galpaoId: { extId: { top, left } } }
   ─────────────────────────────────────────────────────────── */

const DADOS_PADRAO = {
  galpoes:  { "A": { nome: "Galpão A", imagem: "imagens/galpaoA.png", fundo: "escuro" } },
  dados:    { "A": { "1": { tipo: "Pó Químico ABC", validade: "2026-05-10", setor: "Porta Principal" }, "2": { tipo: "CO₂", validade: "2026-03-25", setor: "Corredor B" } } },
  posicoes: { "A": { "1": { top: "100px", left: "200px" }, "2": { top: "250px", left: "400px" } } }
};

let galpoes  = {};
let dados    = {};
let posicoes = {};

let galpaoAtivo       = "A";
let modoAtual         = null;   // null | "mover" | "colocar"
let idAtivo           = null;
let viewAtual         = "mapa";
let pz                = null;
let pinFantasma       = null;
let novoExtintorDados = null;

/* ── DOM CACHE ──────────────────────────────────────────────
   Todas as referências fixas ficam aqui após _cacheEls().
   Chama document.getElementById UMA vez por elemento,
   independente de quantas vezes a função que usa for chamada. */
const EL = {};
function _cacheEls() {
  const ids = [
    'mapa','mapaImg','mapaContainer',
    'viewMapa','viewLista','viewTitle','viewSub',
    'tabsList',
    'statsLabel','statTotal','statOk','statWarn','statExp',
    'btnEdicao','modoEdBadge','modoEdBadgeTexto',
    'detailPanel',
    'dpId','dpNome','dpStatusBar','dpStatusIcon','dpStatusText','dpDias',
    'editSetor','editTipo','editValidade',
    'novoId','idFeedback','btnConfirmarCadastro',
    'novoSetor','novoTipo','novaValidade',
    'nomeGalpao','imagemGalpao',
    'modalEdicao','modalCadastro','modalGalpao','modalExcluirGalpao','modalRenomear',
    'textoExcluirGalpao','renomearGalpaoId','renomearGalpaoNome','renomearGalpaoImg',
    'listaContainer','toast-container'
  ];
  ids.forEach(id => { EL[id] = document.getElementById(id); });
  EL.toastContainer = EL['toast-container'];
  EL.navItems       = document.querySelectorAll('.nav-item');
  EL.idInputWrap    = EL.novoId.parentElement; // <div class="id-input-wrap">
}

/* Map de refs DOM por galpão: galpaoId → Map(extId → el) */
const pontoElsPorGalpao = {};
function getPontoEls() {
  if (!pontoElsPorGalpao[galpaoAtivo]) pontoElsPorGalpao[galpaoAtivo] = new Map();
  return pontoElsPorGalpao[galpaoAtivo];
}

/* ── PERSISTÊNCIA ───────────────────────────────────────── */
let _saveTimer = null;
function salvarStorage() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(_escreveStorage, 400);
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
    if (g && d && p) {
      galpoes  = JSON.parse(g);
      dados    = JSON.parse(d);
      posicoes = JSON.parse(p);
    } else {
      galpoes  = JSON.parse(JSON.stringify(DADOS_PADRAO.galpoes));
      dados    = JSON.parse(JSON.stringify(DADOS_PADRAO.dados));
      posicoes = JSON.parse(JSON.stringify(DADOS_PADRAO.posicoes));
    }
    if (!galpoes[galpaoAtivo]) galpaoAtivo = Object.keys(galpoes)[0];
    Object.keys(galpoes).forEach(gid => {
      if (!dados[gid])         dados[gid]         = {};
      if (!posicoes[gid])      posicoes[gid]       = {};
      if (!galpoes[gid].fundo) galpoes[gid].fundo  = "escuro"; // migração
    });
  } catch(e) {
    galpoes  = JSON.parse(JSON.stringify(DADOS_PADRAO.galpoes));
    dados    = JSON.parse(JSON.stringify(DADOS_PADRAO.dados));
    posicoes = JSON.parse(JSON.stringify(DADOS_PADRAO.posicoes));
  }
}

/* ── DATAS / STATUS ─────────────────────────────────────────
   getHoje() cacheia o Date do dia atual por 60 s.
   Antes, new Date() era criado em CADA chamada de
   calcularStatus() e diasRestantes() — chegando a 200+
   objetos num render de lista com 50 extintores.

   calcularDias() é a função-raiz: parseia a string de
   validade UMA vez e retorna o número de dias. As demais
   funções derivam dela sem refazer o cálculo.            */
let _hojeCache = null, _hojeTS = 0;
function getHoje() {
  const now = Date.now();
  if (now - _hojeTS > 60_000) {
    _hojeCache = new Date(); _hojeCache.setHours(0, 0, 0, 0);
    _hojeTS = now;
  }
  return _hojeCache;
}
function calcularDias(val) {
  if (!val) return -999;
  return Math.ceil((new Date(val + "T00:00:00") - getHoje()) / 86400000);
}
function calcularStatus(val) {
  const d = calcularDias(val);
  return (d === -999 || d < 0) ? "vermelho" : d <= 30 ? "amarelo" : "verde";
}
function diasRestantes(val) { return calcularDias(val); }
function diasLabel(val) {
  const d = calcularDias(val);
  if (d === -999) return "Sem validade";
  if (d < 0)      return `${Math.abs(d)} dias vencido`;
  if (d === 0)    return "Vence hoje!";
  return `${d} dias restantes`;
}
function statusLabel(s) { return { verde:"Em dia", amarelo:"Vencendo em breve", vermelho:"Vencido" }[s]; }
function statusIcon(s)  { return { verde:"✓", amarelo:"⚠", vermelho:"✕" }[s]; }

/* statusGalpao: for…of com break antecipado — para assim
   que encontra o primeiro vermelho, sem iterar o resto.   */
function statusGalpao(gid) {
  const ext = dados[gid] || {};
  const ids = Object.keys(ext);
  if (!ids.length) return "neutro";
  let temAmarelo = false;
  for (const id of ids) {
    const d = calcularDias(ext[id].validade);
    if (d === -999 || d < 0) return "vermelho"; // sai imediatamente
    if (d <= 30) temAmarelo = true;
  }
  return temAmarelo ? "amarelo" : "verde";
}

/* ── STATS ── */
function atualizarStats() {
  const ext = dados[galpaoAtivo] || {};
  const ids = Object.keys(ext);
  let ok = 0, warn = 0, exp = 0;
  for (const id of ids) {
    const d = calcularDias(ext[id].validade);
    if (d === -999 || d < 0) exp++;
    else if (d <= 30) warn++;
    else ok++;
  }
  EL.statTotal.textContent  = ids.length;
  EL.statOk.textContent     = ok;
  EL.statWarn.textContent   = warn;
  EL.statExp.textContent    = exp;
  EL.statsLabel.textContent = galpoes[galpaoAtivo]?.nome || galpaoAtivo;
}

/* ════════════════════════════════════════
   ABAS DE GALPÃO
   ════════════════════════════════════════ */

/* renderizarAbas: full rebuild — necessário apenas quando
   a estrutura muda (criar / excluir / renomear galpão).
   Adiciona data-gid e .tab-qtd para uso em atualizarAbaStatus. */
function renderizarAbas() {
  EL.tabsList.innerHTML = Object.keys(galpoes).map(gid => {
    const g      = galpoes[gid];
    const status = statusGalpao(gid);
    const ativo  = gid === galpaoAtivo ? "active" : "";
    const qtd    = Object.keys(dados[gid] || {}).length;
    return `
      <div class="tab ${ativo}" data-gid="${gid}" onclick="trocarGalpao('${gid}')">
        <span class="tab-dot ${status}"></span>
        <span class="tab-nome">${g.nome}</span>
        <span class="tab-qtd" style="font-size:10px;color:var(--text3);font-weight:500">${qtd}</span>
        <span class="tab-action" onclick="abrirRenomearGalpao(event,'${gid}')" title="Renomear galpão">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </span>
        <span class="tab-close" onclick="pedirExcluirGalpao(event,'${gid}')" title="Excluir galpão">✕</span>
      </div>`;
  }).join("");
}

/* atualizarAbaStatus: atualiza SOMENTE o dot e o contador
   de uma aba específica via data-gid — sem destruir/recriar
   o HTML de todas as abas. Substitui renderizarAbas() nas
   operações rotineiras (salvar, remover, registrar recarga). */
function atualizarAbaStatus(gid) {
  const tab = EL.tabsList.querySelector(`.tab[data-gid="${gid}"]`);
  if (!tab) { renderizarAbas(); return; } // fallback de segurança
  tab.querySelector('.tab-dot').className = `tab-dot ${statusGalpao(gid)}`;
  tab.querySelector('.tab-qtd').textContent = Object.keys(dados[gid] || {}).length;
}

function trocarGalpao(gid) {
  if (gid === galpaoAtivo) return;
  sairModoEdicaoSilencioso();
  fecharPainel();
  // Troca só a classe "active" — sem reconstruir toda a lista de abas
  EL.tabsList.querySelector(`.tab[data-gid="${galpaoAtivo}"]`)?.classList.remove('active');
  EL.tabsList.querySelector(`.tab[data-gid="${gid}"]`)?.classList.add('active');
  galpaoAtivo = gid;
  carregarMapa();
  renderizarPontos();
  atualizarStats();
  if (viewAtual === "lista") renderizarLista();
  EL.viewSub.textContent = subtitleAtual();
}

function subtitleAtual() {
  const qtd = Object.keys(dados[galpaoAtivo] || {}).length;
  return viewAtual === "mapa"
    ? `${galpoes[galpaoAtivo]?.nome} · clique num extintor para detalhes`
    : `${qtd} extintor${qtd !== 1 ? "es" : ""} cadastrado${qtd !== 1 ? "s" : ""}`;
}

/* ── CARREGAR IMAGEM DO MAPA ── */
function carregarMapa() {
  const src = galpoes[galpaoAtivo]?.imagem || "";
  EL.viewMapa.classList.toggle("fundo-claro", (galpoes[galpaoAtivo]?.fundo || "escuro") === "claro");

  // Limpa handlers anteriores antes de qualquer coisa
  EL.mapaImg.onload  = null;
  EL.mapaImg.onerror = null;

  if (src) {
    EL.mapaImg.classList.remove("no-image");
    EL.mapaImg.onload  = () => fitMapa();
    EL.mapaImg.onerror = () => {
      EL.mapaImg.onerror = null;
      EL.mapaImg.src = "";
      EL.mapaImg.classList.add("no-image");
      setTimeout(fitMapa, 50);
    };
    EL.mapaImg.src = src;
    // Se já estava em cache e complete=true o onload não vai disparar de novo
    if (EL.mapaImg.complete && EL.mapaImg.naturalWidth > 0) {
      EL.mapaImg.onload = null;
      fitMapa();
    }
  } else {
    EL.mapaImg.src = "";
    EL.mapaImg.classList.add("no-image");
    setTimeout(fitMapa, 50);
  }
}

/* ════════════════════════════════════════
   GERENCIAR GALPÕES
   ════════════════════════════════════════ */
function abrirModalGalpao() {
  EL.nomeGalpao.value   = "";
  EL.imagemGalpao.value = "";
  document.getElementById("fundoGalpaoEscuro").checked = true;
  EL.modalGalpao.classList.remove("hidden");
  setTimeout(() => EL.nomeGalpao.focus(), 100);
}
function fecharModalGalpao() { EL.modalGalpao.classList.add("hidden"); }

function confirmarNovoGalpao() {
  const nome   = EL.nomeGalpao.value.trim();
  const imagem = EL.imagemGalpao.value.trim();
  const fundo  = document.querySelector('input[name="fundoGalpao"]:checked')?.value || "escuro";
  if (!nome) { toast("Informe o nome do galpão!", "err"); return; }

  const ids = Object.keys(galpoes);
  let novoId = String.fromCharCode(65 + ids.length);
  while (galpoes[novoId]) novoId += "_";

  galpoes[novoId]  = { nome, imagem: imagem || "", fundo };
  dados[novoId]    = {};
  posicoes[novoId] = {};

  fecharModalGalpao();
  salvarStorageImediato();
  renderizarAbas();       // full rebuild (nova aba adicionada)
  trocarGalpao(novoId);   // só troca classe active + carrega mapa
  toast(`${nome} criado!`, "ok");
}

let _galpaoParaExcluir = null;
function pedirExcluirGalpao(e, gid) {
  e.stopPropagation();
  _galpaoParaExcluir = gid;
  const nome = galpoes[gid]?.nome || gid;
  const qtd  = Object.keys(dados[gid] || {}).length;
  EL.textoExcluirGalpao.innerHTML =
    `Deseja excluir <strong>${nome}</strong>?` +
    (qtd > 0 ? `<br><br>Isso removerá também os <strong>${qtd} extintor${qtd > 1 ? "es" : ""}</strong> cadastrados nele.` : "");
  EL.modalExcluirGalpao.classList.remove("hidden");
}
function fecharModalExcluirGalpao() {
  EL.modalExcluirGalpao.classList.add("hidden");
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
  renderizarAbas(); // full rebuild (aba removida)
  renderizarPontos();
  atualizarStats();
  toast(`${nome} excluído`, "warn");
}

/* ════════════════════════════════════════
   PONTOS
   ════════════════════════════════════════ */
function renderizarPontos() {
  EL.mapa.querySelectorAll(".ponto").forEach(el => el.remove());
  // Limpa APENAS o mapa ativo — não invalida cache de outros galpões
  if (pontoElsPorGalpao[galpaoAtivo]) pontoElsPorGalpao[galpaoAtivo].clear();
  const ext = dados[galpaoAtivo] || {};
  Object.keys(ext).forEach(id => renderPonto(id));
  atualizarStats();
}

function renderPonto(id) {
  const ext = dados[galpaoAtivo]?.[id];
  const pos = posicoes[galpaoAtivo]?.[id];
  if (!ext || !pos) return;

  // Uma única chamada para dias; status derivado localmente
  const dias   = calcularDias(ext.validade);
  const status = (dias === -999 || dias < 0) ? "vermelho" : dias <= 30 ? "amarelo" : "verde";

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

  EL.mapa.appendChild(div);
  getPontoEls().set(String(id), div);
}

function atualizarPonto(id) {
  const el = getPontoEls().get(String(id));
  if (!el) return;
  const ext  = dados[galpaoAtivo]?.[id];
  const dias = calcularDias(ext?.validade);
  const status = (dias === -999 || dias < 0) ? "vermelho" : dias <= 30 ? "amarelo" : "verde";
  el.className = `ponto ${status}${idAtivo == id ? " selecionado" : ""}`;
  const tt = el.querySelector(".ttip");
  if (tt) tt.textContent = `#${id} — ${ext?.tipo} · ${dias < 0 ? "VENCIDO" : dias === 0 ? "Hoje!" : dias + "d"}`;
}

/* ── DRAG (RAF + cache rect) ── */
function iniciarDrag(div, id, e) {
  const rect = EL.mapa.getBoundingClientRect();
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
    document.removeEventListener("mouseup",   onUp);
  }
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup",   onUp);
}

/* ── COLOCAR EXTINTOR ──
   Listener registrado aqui (antes do _cacheEls) via getElementById
   para não depender do EL ainda não inicializado.            */
document.getElementById("mapa").addEventListener("click", e => {
  if (modoAtual !== "colocar" || !novoExtintorDados) return;
  if (e.target.closest(".ponto:not(.fantasma)")) return;
  const rect = EL.mapa.getBoundingClientRect();
  const x    = Math.round(e.clientX - rect.left);
  const y    = Math.round(e.clientY - rect.top);
  const id   = novoExtintorDados.id;
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
  atualizarAbaStatus(galpaoAtivo);
  modoAtual = "mover";
  EL.mapaContainer.classList.remove("modo-adicionar");
  EL.modoEdBadgeTexto.textContent = "Modo mover — arraste os extintores";
  toast(`Extintor #${id} posicionado!`, "ok");
});

/* ── PIN FANTASMA ── */
function criarPinFantasma() {
  if (pinFantasma) pinFantasma.remove();
  pinFantasma = document.createElement("div");
  pinFantasma.className = "ponto fantasma verde";
  Object.assign(pinFantasma.style, {
    zIndex: "100", pointerEvents: "none", position: "absolute",
    display: "none", willChange: "left,top"
  });
  EL.mapa.appendChild(pinFantasma);
}
let _pinRaf = null;
document.getElementById("mapaContainer").addEventListener("mousemove", e => {
  if (modoAtual !== "colocar" || !pinFantasma) return;
  const rect = EL.mapa.getBoundingClientRect();
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
document.getElementById("mapaContainer").addEventListener("wheel", e => { if (pz) pz.zoomWithWheel(e); });

/* ════════════════════════════════════════
   MODO EDIÇÃO
   ════════════════════════════════════════ */
function toggleEdicao() {
  if (modoAtual) { sairModoEdicao(); return; }
  EL.modalEdicao.classList.remove("hidden");
}
function fecharModalEdicao() { EL.modalEdicao.classList.add("hidden"); }

function entrarModoMover() {
  fecharModalEdicao();
  modoAtual = "mover";
  destruirPanzoom();
  EL.btnEdicao.classList.add("ativo");
  EL.modoEdBadge.classList.remove("hidden");
  EL.modoEdBadgeTexto.textContent = "Modo mover — arraste os extintores";
  fecharPainel();
  toast("Modo mover ativo", "warn");
}
function entrarModoCriar() {
  fecharModalEdicao();
  const sugestao = proximoIdDisponivel();
  EL.novoId.value = sugestao;
  validarId(sugestao);
  EL.modalCadastro.classList.remove("hidden");
  setTimeout(() => EL.novoId.focus(), 100);
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
  EL.btnEdicao.classList.remove("ativo");
  EL.modoEdBadge.classList.add("hidden");
  EL.mapaContainer.classList.remove("modo-adicionar");
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

/* validarIdDebounce: 80ms de debounce no oninput.
   Antes, validarId() era chamado a cada tecla com 3 getElementById
   + classList mutations. Com debounce, só dispara quando o usuário
   pausa de digitar, eliminando travadas em IDs longos.         */
let _validarTimer = null;
function validarIdDebounce(val) {
  clearTimeout(_validarTimer);
  _validarTimer = setTimeout(() => validarId(val), 80);
}
function validarId(val) {
  const v = val.trim();
  if (!v) {
    EL.idInputWrap.classList.remove("id-ok", "id-erro");
    EL.idFeedback.textContent = ""; EL.idFeedback.className = "id-feedback";
    EL.btnConfirmarCadastro.disabled = false;
    return;
  }
  if (idJaExiste(v)) {
    EL.idInputWrap.classList.remove("id-ok"); EL.idInputWrap.classList.add("id-erro");
    EL.idFeedback.textContent = `#${v} já existe neste galpão`;
    EL.idFeedback.className   = "id-feedback erro";
    EL.btnConfirmarCadastro.disabled = true;
  } else {
    EL.idInputWrap.classList.remove("id-erro"); EL.idInputWrap.classList.add("id-ok");
    EL.idFeedback.textContent = `#${v} disponível`;
    EL.idFeedback.className   = "id-feedback ok";
    EL.btnConfirmarCadastro.disabled = false;
  }
}
function usarProximoId() {
  const s = proximoIdDisponivel();
  EL.novoId.value = s;
  validarId(s); // imediato — ação de botão, não digitação
  EL.novoId.focus();
}
function confirmarCadastro() {
  const idRaw    = EL.novoId.value.trim();
  const tipo     = EL.novoTipo.value;
  const validade = EL.novaValidade.value;
  const setor    = EL.novoSetor.value.trim();
  if (!idRaw)        { toast("Informe a identificação!", "err"); return; }
  if (!validade)     { toast("Informe a validade!", "err"); return; }
  if (idJaExiste(idRaw)) { toast(`#${idRaw} já existe!`, "err"); return; }

  novoExtintorDados = { id: idRaw, tipo, validade, setor: setor || galpoes[galpaoAtivo]?.nome || "Galpão" };
  EL.modalCadastro.classList.add("hidden");
  EL.novoId.value = ""; EL.novoSetor.value = ""; EL.novaValidade.value = "";
  EL.idFeedback.textContent = "";
  EL.idInputWrap.classList.remove("id-ok", "id-erro");
  EL.btnConfirmarCadastro.disabled = false;

  modoAtual = "colocar";
  destruirPanzoom();
  EL.btnEdicao.classList.add("ativo");
  EL.modoEdBadge.classList.remove("hidden");
  EL.modoEdBadgeTexto.textContent = "Clique no mapa para posicionar";
  EL.mapaContainer.classList.add("modo-adicionar");
  criarPinFantasma();
  toast("Clique no mapa para posicionar o extintor", "warn");
}
function cancelarCadastro() {
  EL.modalCadastro.classList.add("hidden");
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
  EL.dpId.textContent         = `EXTINTOR #${id}`;
  EL.dpNome.textContent       = ext?.tipo || "—";
  EL.dpStatusBar.className    = `dp-status-bar s-${status}`;
  EL.dpStatusIcon.textContent = statusIcon(status);
  EL.dpStatusText.textContent = statusLabel(status);
  EL.dpDias.textContent       = ext?.validade ? diasLabel(ext.validade) : "—";
  EL.editSetor.value          = ext?.setor    || "";
  EL.editTipo.value           = ext?.tipo     || "Pó Químico ABC";
  EL.editValidade.value       = ext?.validade || "";
  EL.detailPanel.classList.remove("hidden");
}
function fecharPainel() {
  if (idAtivo !== null) {
    const el = getPontoEls().get(String(idAtivo));
    if (el) el.classList.remove("selecionado");
  }
  idAtivo = null;
  EL.detailPanel.classList.add("hidden");
}

/* _atualizarPainelStatus: atualiza SOMENTE a barra de status
   do painel aberto, sem re-renderizar o painel inteiro.
   Antes, salvarEdicao() chamava abrirPainel() completo (7
   getElementById + 7 atribuições + toggle de classe).       */
function _atualizarPainelStatus() {
  const ext = dados[galpaoAtivo]?.[idAtivo];
  if (!ext) return;
  const status = calcularStatus(ext.validade);
  EL.dpNome.textContent       = ext.tipo || "—";
  EL.dpStatusBar.className    = `dp-status-bar s-${status}`;
  EL.dpStatusIcon.textContent = statusIcon(status);
  EL.dpStatusText.textContent = statusLabel(status);
  EL.dpDias.textContent       = ext.validade ? diasLabel(ext.validade) : "—";
}

function salvarEdicao() {
  if (!idAtivo) return;
  const val = EL.editValidade.value;
  if (!val) { toast("Informe a validade!", "err"); return; }
  const ext    = dados[galpaoAtivo][idAtivo];
  ext.tipo     = EL.editTipo.value;
  ext.validade = val;
  ext.setor    = EL.editSetor.value.trim() || ext.setor;
  salvarStorageImediato();
  atualizarPonto(idAtivo);
  atualizarStats();
  atualizarAbaStatus(galpaoAtivo);  // antes: renderizarAbas() full rebuild
  _atualizarPainelStatus();         // antes: abrirPainel() full re-render
  if (viewAtual === "lista") renderizarLista();
  toast("Extintor atualizado!", "ok");
}

function trocarValidade() {
  if (!idAtivo) return;
  const nova    = new Date(); nova.setFullYear(nova.getFullYear() + 1);
  const novaVal = nova.toISOString().split("T")[0];
  dados[galpaoAtivo][idAtivo].validade = novaVal;
  EL.editValidade.value = novaVal; // mantém o campo sincronizado
  salvarStorageImediato();
  atualizarPonto(idAtivo);
  atualizarStats();
  atualizarAbaStatus(galpaoAtivo);
  _atualizarPainelStatus();
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
  atualizarAbaStatus(galpaoAtivo); // antes: renderizarAbas() full rebuild
  if (viewAtual === "lista") renderizarLista();
  toast(`Extintor #${id} removido`, "warn");
}

/* ════════════════════════════════════════
   VIEWS / LISTA
   ════════════════════════════════════════ */
function setView(v) {
  viewAtual = v;
  EL.viewMapa.classList.toggle("hidden",  v !== "mapa");
  EL.viewLista.classList.toggle("hidden", v !== "lista");
  EL.navItems.forEach(n => n.classList.remove("active"));
  event?.currentTarget?.classList.add("active");
  EL.viewTitle.textContent = v === "mapa" ? "Mapa de Extintores" : "Lista de Extintores";
  EL.viewSub.textContent   = subtitleAtual();
  if (v === "lista") renderizarLista();
}

let _listaTimer = null;
function filtrarLista(v) {
  clearTimeout(_listaTimer);
  _listaTimer = setTimeout(() => { if (viewAtual === "lista") renderizarLista(v); }, 150);
}

function renderizarLista(filtro = "") {
  const ext = dados[galpaoAtivo] || {};
  let ids = Object.keys(ext);
  if (filtro) {
    const f = filtro.toLowerCase();
    ids = ids.filter(id =>
      String(id).includes(f) ||
      ext[id].tipo.toLowerCase().includes(f) ||
      ext[id].setor.toLowerCase().includes(f)
    );
  }
  if (!ids.length) {
    EL.listaContainer.innerHTML = `<div style="color:var(--text3);font-size:14px;padding:20px">Nenhum extintor encontrado.</div>`;
    return;
  }
  ids.sort((a, b) => isNaN(a) || isNaN(b) ? a.localeCompare(b) : +a - +b);
  // calcularDias() chamado UMA vez por card (antes: calcularStatus + diasRestantes = 2×)
  EL.listaContainer.innerHTML = ids.map(id => {
    const e      = ext[id];
    const dias   = calcularDias(e.validade);
    const status = (dias === -999 || dias < 0) ? "vermelho" : dias <= 30 ? "amarelo" : "verde";
    const dTx    = dias === -999 ? "—" : dias < 0 ? `${Math.abs(dias)}d vencido` : dias === 0 ? "Hoje!" : `${dias}d`;
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
  EL.navItems[0].classList.add("active");
  EL.navItems[1].classList.remove("active");
  setTimeout(() => abrirPainel(id), 50);
}

/* ════════════════════════════════════════
   PANZOOM
   ════════════════════════════════════════ */
function criarPanzoom() {
  if (pz) return;
  pz = Panzoom(document.getElementById("mapa"), {
    maxScale: 5,
    minScale: 0.05,
    contain:  false,
  });
}
function destruirPanzoom() { if (!pz) return; pz.destroy(); pz = null; }
function resetZoom()        { fitMapa(); }

/* fitMapa — calcula a escala que faz a imagem caber inteira
   no container com um padding confortável, e a centraliza.
   Chamada no onload da imagem, na troca de galpão e no
   botão "Resetar Zoom".                                     */
function fitMapa() {
  if (!pz) return;
  const cW = EL.mapaContainer.clientWidth;
  const cH = EL.mapaContainer.clientHeight;
  const iW = EL.mapaImg.naturalWidth  || EL.mapaImg.offsetWidth  || 900;
  const iH = EL.mapaImg.naturalHeight || EL.mapaImg.offsetHeight || 540;
  if (!cW || !cH || !iW || !iH) return;

  const PAD = 56; // px de respiro em cada lado
  const scale = Math.min((cW - PAD * 2) / iW, (cH - PAD * 2) / iH);
  const s = Math.min(Math.max(scale, 0.05), 2); // clamp: não amplia além de 2× no fit

  // pan: posição que centraliza a imagem escalada no container
  const x = (cW - iW * s) / 2;
  const y = (cH - iH * s) / 2;

  pz.zoom(s, { animate: false });
  pz.pan(x, y, { animate: false });
}

/* ── TOAST ── */
function toast(msg, tipo = "") {
  const el = document.createElement("div");
  el.className = `toast ${tipo}`; el.textContent = msg;
  EL.toastContainer.appendChild(el);
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
      const e  = ext[id];
      const d  = calcularDias(e.validade);
      const s  = (d === -999 || d < 0) ? "vermelho" : d <= 30 ? "amarelo" : "verde";
      const sx = s==="verde"?"✓ EM DIA":s==="amarelo"?"⚠ VENCENDO":"✕ VENCIDO";
      const dTx= d >= 0 ? `${d}d restantes` : `${Math.abs(d)}d vencido`;
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
  const fundo = galpoes[gid]?.fundo || "escuro";
  EL.renomearGalpaoId.value   = gid;
  EL.renomearGalpaoNome.value = galpoes[gid]?.nome   || "";
  EL.renomearGalpaoImg.value  = galpoes[gid]?.imagem || "";
  document.getElementById(fundo === "claro" ? "renomearFundoClaro" : "renomearFundoEscuro").checked = true;
  EL.modalRenomear.classList.remove("hidden");
  setTimeout(() => { EL.renomearGalpaoNome.focus(); EL.renomearGalpaoNome.select(); }, 100);
}
function fecharModalRenomear() { EL.modalRenomear.classList.add("hidden"); }

function confirmarRenomear() {
  const gid    = EL.renomearGalpaoId.value;
  const nome   = EL.renomearGalpaoNome.value.trim();
  const imagem = EL.renomearGalpaoImg.value.trim();
  const fundo  = document.querySelector('input[name="renomearFundo"]:checked')?.value || "escuro";
  if (!nome) { toast("Informe um nome!", "err"); return; }
  galpoes[gid].nome   = nome;
  galpoes[gid].imagem = imagem;
  galpoes[gid].fundo  = fundo;
  fecharModalRenomear();
  salvarStorageImediato();
  if (gid === galpaoAtivo) carregarMapa();
  renderizarAbas(); // full rebuild (nome da aba mudou)
  atualizarStats();
  toast(`${nome} atualizado!`, "ok");
}

/* ════════════════════════════════════════
   INIT
   ════════════════════════════════════════ */
carregarStorage();
_cacheEls();        // popula EL{} — deve rodar antes de qualquer função que usa EL
criarPanzoom();
renderizarAbas();
carregarMapa();
renderizarPontos();
EL.viewSub.textContent = subtitleAtual();
