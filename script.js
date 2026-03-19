/* FireMap — script.js
   Dados: galpoes { id:{nome,imagem,fundo} }
          dados   { galpaoId:{ extId:{tipo,validade,setor} } }
          posicoes{ galpaoId:{ extId:{top,left} } }
   Viewer: #mapaContainer overflow:auto + #mapa transform:scale(viewerScale)
*/

const DADOS_PADRAO = {
  galpoes:  { "A": { nome:"Galpão A", imagem:"imagens/galpaoA.png", fundo:"escuro" } },
  dados:    { "A": { "1":{tipo:"Pó Químico ABC",validade:"2026-05-10",setor:"Porta Principal"}, "2":{tipo:"CO₂",validade:"2026-03-25",setor:"Corredor B"} } },
  posicoes: { "A": { "1":{top:"100px",left:"200px"}, "2":{top:"250px",left:"400px"} } }
};

let galpoes = {}, dados = {}, posicoes = {};
let galpaoAtivo = "A", modoAtual = null, idAtivo = null, viewAtual = "mapa";
let pinFantasma = null, novoExtintorDados = null;
let viewerScale = 1;
const VIEWER_MIN = 0.02, VIEWER_MAX = 8;
const DOT_BASE = 26, DOT_MIN = 16, DOT_MAX = 48;

/* ── DOM CACHE ── */
const EL = {};
function _cacheEls() {
  ['mapa','mapaImg','mapaContainer','mapaScaler',
   'viewMapa','viewLista','viewTitle','viewSub','tabsList',
   'statsLabel','statTotal','statOk','statWarn','statExp',
   'btnEdicao','modoEdBadge','modoEdBadgeTexto','detailPanel',
   'dpId','dpNome','dpStatusBar','dpStatusIcon','dpStatusText','dpDias',
   'editSetor','editTipo','editValidade',
   'novoId','idFeedback','btnConfirmarCadastro','novoSetor','novoTipo','novaValidade',
   'nomeGalpao','imagemGalpao','modalEdicao','modalCadastro','modalGalpao',
   'modalExcluirGalpao','modalRenomear','textoExcluirGalpao',
   'renomearGalpaoId','renomearGalpaoNome','renomearGalpaoImg','listaContainer'
  ].forEach(id => EL[id] = document.getElementById(id));
  EL.toastContainer = document.getElementById('toast-container');
  EL.navItems    = document.querySelectorAll('.nav-item');
  EL.idInputWrap = EL.novoId.parentElement;
}

const pontoElsPorGalpao = {};
function getPontoEls() {
  return pontoElsPorGalpao[galpaoAtivo] ??= new Map();
}

/* ── STORAGE ── */
let _saveTimer = null;
function salvarStorage()        { clearTimeout(_saveTimer); _saveTimer = setTimeout(_gravar, 400); }
function salvarStorageImediato(){ clearTimeout(_saveTimer); _gravar(); }
function _gravar() {
  localStorage.setItem("fm_galpoes",  JSON.stringify(galpoes));
  localStorage.setItem("fm_dados",    JSON.stringify(dados));
  localStorage.setItem("fm_posicoes", JSON.stringify(posicoes));
}
function carregarStorage() {
  const clonar = () => JSON.parse(JSON.stringify(DADOS_PADRAO));
  try {
    const g = localStorage.getItem("fm_galpoes");
    const d = localStorage.getItem("fm_dados");
    const p = localStorage.getItem("fm_posicoes");
    if (g && d && p) { galpoes = JSON.parse(g); dados = JSON.parse(d); posicoes = JSON.parse(p); }
    else             { ({ galpoes, dados, posicoes } = clonar()); }
    if (!galpoes[galpaoAtivo]) galpaoAtivo = Object.keys(galpoes)[0];
    Object.keys(galpoes).forEach(gid => {
      dados[gid]    ??= {};
      posicoes[gid] ??= {};
      galpoes[gid].fundo ??= "escuro";
    });
  } catch { ({ galpoes, dados, posicoes } = clonar()); }
}

/* ── DATAS / STATUS ── */
let _hojeCache = null, _hojeTS = 0;
function getHoje() {
  if (Date.now() - _hojeTS > 60_000) {
    _hojeCache = new Date(); _hojeCache.setHours(0,0,0,0); _hojeTS = Date.now();
  }
  return _hojeCache;
}
function calcularDias(val) {
  return val ? Math.ceil((new Date(val + "T00:00:00") - getHoje()) / 86400000) : -999;
}
function diasToStatus(d)  { return (d === -999 || d < 0) ? "vermelho" : d <= 30 ? "amarelo" : "verde"; }
function calcularStatus(val) { return diasToStatus(calcularDias(val)); }
function diasLabel(val) {
  const d = calcularDias(val);
  if (d === -999) return "Sem validade";
  if (d < 0)      return `${Math.abs(d)} dias vencido`;
  if (d === 0)    return "Vence hoje!";
  return `${d} dias restantes`;
}
const STATUS_LABEL = { verde:"Em dia", amarelo:"Vencendo em breve", vermelho:"Vencido" };
const STATUS_ICON  = { verde:"✓", amarelo:"⚠", vermelho:"✕" };

function statusGalpao(gid) {
  const ext = dados[gid] || {};
  const ids = Object.keys(ext);
  if (!ids.length) return "neutro";
  let amarelo = false;
  for (const id of ids) {
    const d = calcularDias(ext[id].validade);
    if (d === -999 || d < 0) return "vermelho";
    if (d <= 30) amarelo = true;
  }
  return amarelo ? "amarelo" : "verde";
}

/* ── STATS ── */
function atualizarStats() {
  const ext = dados[galpaoAtivo] || {};
  const ids = Object.keys(ext);
  let ok = 0, warn = 0, exp = 0;
  for (const id of ids) {
    const d = calcularDias(ext[id].validade);
    if (d === -999 || d < 0) exp++; else if (d <= 30) warn++; else ok++;
  }
  EL.statTotal.textContent  = ids.length;
  EL.statOk.textContent     = ok;
  EL.statWarn.textContent   = warn;
  EL.statExp.textContent    = exp;
  EL.statsLabel.textContent = galpoes[galpaoAtivo]?.nome || galpaoAtivo;
}

/* ── ABAS ── */
const SVG_EDIT = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;

function renderizarAbas() {
  EL.tabsList.innerHTML = Object.keys(galpoes).map(gid => {
    const g   = galpoes[gid];
    const qtd = Object.keys(dados[gid] || {}).length;
    return `<div class="tab${gid===galpaoAtivo?" active":""}" data-gid="${gid}" onclick="trocarGalpao('${gid}')">
      <span class="tab-dot ${statusGalpao(gid)}"></span>
      <span class="tab-nome">${g.nome}</span>
      <span class="tab-qtd" style="font-size:10px;color:var(--text3);font-weight:500">${qtd}</span>
      <span class="tab-action" onclick="abrirRenomearGalpao(event,'${gid}')" title="Renomear">${SVG_EDIT}</span>
      <span class="tab-close" onclick="pedirExcluirGalpao(event,'${gid}')" title="Excluir">✕</span>
    </div>`;
  }).join("");
}

function atualizarAbaStatus(gid) {
  const tab = EL.tabsList.querySelector(`.tab[data-gid="${gid}"]`);
  if (!tab) { renderizarAbas(); return; }
  tab.querySelector('.tab-dot').className  = `tab-dot ${statusGalpao(gid)}`;
  tab.querySelector('.tab-qtd').textContent = Object.keys(dados[gid] || {}).length;
}

function trocarGalpao(gid) {
  if (gid === galpaoAtivo) return;
  sairModoEdicaoSilencioso();
  fecharPainel();
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
    : `${qtd} extintor${qtd!==1?"es":""} cadastrado${qtd!==1?"s":""}`;
}

/* ── VIEWER ── */
function applyViewerScale(newScale, pivotCX, pivotCY) {
  const old = viewerScale;
  viewerScale = Math.max(VIEWER_MIN, Math.min(VIEWER_MAX, newScale));

  const img = EL.mapaImg;
  const iW  = img.naturalWidth  || EL.mapaContainer.clientWidth  || 900;
  const iH  = img.naturalHeight || EL.mapaContainer.clientHeight || 540;
  const sW  = iW * viewerScale, sH = iH * viewerScale;
  const cW  = EL.mapaContainer.clientWidth, cH = EL.mapaContainer.clientHeight;

  EL.mapaScaler.style.width  = Math.max(sW, cW) + "px";
  EL.mapaScaler.style.height = Math.max(sH, cH) + "px";
  EL.mapa.style.width        = iW + "px";
  EL.mapa.style.height       = iH + "px";
  EL.mapa.style.transform    = `scale(${viewerScale})`;
  EL.mapa.style.left         = (sW < cW ? (cW - sW) / 2 : 0) + "px";
  EL.mapa.style.top          = (sH < cH ? (cH - sH) / 2 : 0) + "px";

  if (pivotCX !== undefined) {
    const ratio = viewerScale / old;
    EL.mapaContainer.scrollLeft = (EL.mapaContainer.scrollLeft + pivotCX) * ratio - pivotCX;
    EL.mapaContainer.scrollTop  = (EL.mapaContainer.scrollTop  + pivotCY) * ratio - pivotCY;
  } else {
    EL.mapaContainer.scrollLeft = Math.max(0, (sW - cW) / 2);
    EL.mapaContainer.scrollTop  = Math.max(0, (sH - cH) / 2);
  }
  _atualizarPontos();
}

function fitViewer() {
  const img = EL.mapaImg;
  const iW  = img.naturalWidth  || 900;
  const iH  = img.naturalHeight || 540;
  const cW  = EL.mapaContainer.clientWidth;
  const cH  = EL.mapaContainer.clientHeight;
  if (!cW || !cH) return;
  applyViewerScale(Math.min(cW / iW, cH / iH));
}

/* ── CARREGAR MAPA ── */
function carregarMapa() {
  const g   = galpoes[galpaoAtivo];
  const src = g?.imagem || "";
  EL.viewMapa.classList.toggle("fundo-claro", (g?.fundo || "escuro") === "claro");
  EL.mapaImg.onload = EL.mapaImg.onerror = null;

  const depois = () => requestAnimationFrame(() => requestAnimationFrame(fitViewer));

  if (src) {
    EL.mapaImg.classList.remove("no-image");
    if (EL.mapaImg.complete && EL.mapaImg.naturalWidth > 0 && EL.mapaImg.src.endsWith(src)) {
      depois();
    } else {
      EL.mapaImg.onload  = () => { EL.mapaImg.onload = null; depois(); };
      EL.mapaImg.onerror = () => { EL.mapaImg.onerror = null; EL.mapaImg.src = ""; EL.mapaImg.classList.add("no-image"); depois(); };
      EL.mapaImg.src = src;
    }
  } else {
    EL.mapaImg.src = "";
    EL.mapaImg.classList.add("no-image");
    depois();
  }
}

/* ── WHEEL ZOOM ── */
document.getElementById("mapaContainer").addEventListener("wheel", e => {
  e.preventDefault();
  const r = EL.mapaContainer.getBoundingClientRect();
  applyViewerScale(viewerScale * (e.deltaY < 0 ? 1.12 : 1/1.12), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

/* ── PAN ── */
let _pan = { on:false, x:0, y:0, sl:0, st:0 };
document.getElementById("mapaContainer").addEventListener("mousedown", e => {
  if (modoAtual === "colocar" || e.button) return;
  _pan = { on:true, x:e.clientX, y:e.clientY, sl:EL.mapaContainer.scrollLeft, st:EL.mapaContainer.scrollTop };
  EL.mapaContainer.style.cursor = "grabbing";
  e.preventDefault();
});
document.addEventListener("mousemove", e => {
  if (!_pan.on) return;
  EL.mapaContainer.scrollLeft = _pan.sl - (e.clientX - _pan.x);
  EL.mapaContainer.scrollTop  = _pan.st - (e.clientY - _pan.y);
});
document.addEventListener("mouseup", () => {
  if (!_pan.on) return;
  _pan.on = false;
  EL.mapaContainer.style.cursor = modoAtual === "colocar" ? "crosshair" : "grab";
});
document.getElementById("mapaContainer").addEventListener("mouseleave", () => {
  if (pinFantasma) pinFantasma.style.display = "none";
});

/* ── GERENCIAR GALPÕES ── */
function abrirModalGalpao() {
  EL.nomeGalpao.value = EL.imagemGalpao.value = "";
  document.getElementById("fundoGalpaoEscuro").checked = true;
  EL.modalGalpao.classList.remove("hidden");
  setTimeout(() => EL.nomeGalpao.focus(), 100);
}
function fecharModalGalpao() { EL.modalGalpao.classList.add("hidden"); }

function confirmarNovoGalpao() {
  const nome  = EL.nomeGalpao.value.trim();
  const fundo = document.querySelector('input[name="fundoGalpao"]:checked')?.value || "escuro";
  if (!nome) { toast("Informe o nome do galpão!", "err"); return; }
  const ids = Object.keys(galpoes);
  let novoId = String.fromCharCode(65 + ids.length);
  while (galpoes[novoId]) novoId += "_";
  galpoes[novoId]  = { nome, imagem: EL.imagemGalpao.value.trim(), fundo };
  dados[novoId]    = {};
  posicoes[novoId] = {};
  fecharModalGalpao();
  salvarStorageImediato();
  renderizarAbas();
  trocarGalpao(novoId);
  toast(`${nome} criado!`, "ok");
}

let _galpaoParaExcluir = null;
function pedirExcluirGalpao(e, gid) {
  e.stopPropagation();
  _galpaoParaExcluir = gid;
  const qtd = Object.keys(dados[gid] || {}).length;
  EL.textoExcluirGalpao.innerHTML =
    `Deseja excluir <strong>${galpoes[gid]?.nome}</strong>?` +
    (qtd > 0 ? `<br><br>Isso removerá também os <strong>${qtd} extintor${qtd>1?"es":""}</strong> cadastrados nele.` : "");
  EL.modalExcluirGalpao.classList.remove("hidden");
}
function fecharModalExcluirGalpao() {
  EL.modalExcluirGalpao.classList.add("hidden");
  _galpaoParaExcluir = null;
}
function confirmarExcluirGalpao() {
  const gid = _galpaoParaExcluir;
  if (!gid) return;
  if (Object.keys(galpoes).length === 1) { toast("Não é possível excluir o único galpão.", "err"); fecharModalExcluirGalpao(); return; }
  const nome = galpoes[gid]?.nome;
  delete galpoes[gid]; delete dados[gid]; delete posicoes[gid]; delete pontoElsPorGalpao[gid];
  fecharModalExcluirGalpao();
  salvarStorageImediato();
  if (galpaoAtivo === gid) { galpaoAtivo = Object.keys(galpoes)[0]; carregarMapa(); }
  renderizarAbas(); renderizarPontos(); atualizarStats();
  toast(`${nome} excluído`, "warn");
}

/* ── PONTOS ── */
function _dotDomSize() {
  return Math.max(DOT_MIN, Math.min(DOT_MAX, DOT_BASE * viewerScale)) / viewerScale;
}
function _ttipTexto(id, ext, dias) {
  return `#${id} — ${ext.tipo} · ${dias < 0 ? "VENCIDO" : dias === 0 ? "Hoje!" : dias + "d"}`;
}
function _atualizarPontos() {
  const sz = _dotDomSize() + "px";
  EL.mapa.style.setProperty("--ttip-scale", (1 / viewerScale).toFixed(4));
  EL.mapa.querySelectorAll(".ponto").forEach(el => { el.style.width = el.style.height = sz; });
}

function renderizarPontos() {
  EL.mapa.querySelectorAll(".ponto").forEach(el => el.remove());
  pontoElsPorGalpao[galpaoAtivo]?.clear();
  Object.keys(dados[galpaoAtivo] || {}).forEach(id => renderPonto(id));
  atualizarStats();
}

function renderPonto(id) {
  const ext = dados[galpaoAtivo]?.[id];
  const pos = posicoes[galpaoAtivo]?.[id];
  if (!ext || !pos) return;
  const dias = calcularDias(ext.validade);
  const sz   = _dotDomSize() + "px";

  const div = document.createElement("div");
  div.id        = "p" + id;
  div.className = `ponto ${diasToStatus(dias)}${idAtivo == id ? " selecionado" : ""}`;
  div.style.cssText = `top:${pos.top};left:${pos.left};z-index:20;width:${sz};height:${sz}`;

  const tt = document.createElement("div");
  tt.className   = "ttip";
  tt.textContent = _ttipTexto(id, ext, dias);
  div.appendChild(tt);

  div.addEventListener("click", e => { if (modoAtual) return; e.stopPropagation(); abrirPainel(id); });
  div.addEventListener("mousedown", e => { if (modoAtual !== "mover") return; e.stopPropagation(); e.preventDefault(); iniciarDrag(div, id, e); });

  EL.mapa.appendChild(div);
  getPontoEls().set(String(id), div);
}

function atualizarPonto(id) {
  const el = getPontoEls().get(String(id));
  if (!el) return;
  const ext  = dados[galpaoAtivo]?.[id];
  const dias = calcularDias(ext?.validade);
  const sz   = _dotDomSize() + "px";
  el.className    = `ponto ${diasToStatus(dias)}${idAtivo == id ? " selecionado" : ""}`;
  el.style.width  = el.style.height = sz;
  const tt = el.querySelector(".ttip");
  if (tt) tt.textContent = _ttipTexto(id, ext, dias);
}

/* ── DRAG DE PONTO ── */
function iniciarDrag(div, id, e) {
  const rect = EL.mapa.getBoundingClientRect();
  const ox = (e.clientX - rect.left) / viewerScale - parseFloat(div.style.left);
  const oy = (e.clientY - rect.top)  / viewerScale - parseFloat(div.style.top);
  let px = parseFloat(div.style.left), py = parseFloat(div.style.top);
  let raf = null, moveu = false;
  div.style.willChange = "left,top"; div.style.opacity = "0.8";
  document.body.style.userSelect = "none";

  function onMove(ev) {
    px = (ev.clientX - rect.left) / viewerScale - ox;
    py = (ev.clientY - rect.top)  / viewerScale - oy;
    moveu = true;
    if (!raf) raf = requestAnimationFrame(() => { div.style.left = px+"px"; div.style.top = py+"px"; raf = null; });
  }
  function onUp() {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    div.style.willChange = ""; div.style.opacity = "1";
    document.body.style.userSelect = "";
    if (moveu) { posicoes[galpaoAtivo][id] = { top: div.style.top, left: div.style.left }; salvarStorage(); toast("Posição salva", "ok"); }
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
  const rect = EL.mapa.getBoundingClientRect();
  const x = Math.round((e.clientX - rect.left) / viewerScale);
  const y = Math.round((e.clientY - rect.top)  / viewerScale);
  const { id, ...rest } = novoExtintorDados;
  dados[galpaoAtivo][id]    = rest;
  posicoes[galpaoAtivo][id] = { top: y+"px", left: x+"px" };
  novoExtintorDados = null;
  if (pinFantasma) { pinFantasma.remove(); pinFantasma = null; }
  salvarStorageImediato();
  renderPonto(id); atualizarStats(); atualizarAbaStatus(galpaoAtivo);
  modoAtual = "mover";
  EL.mapaContainer.classList.remove("modo-adicionar");
  EL.mapaContainer.style.cursor = "grab";
  EL.modoEdBadgeTexto.textContent = "Modo mover — arraste os extintores";
  toast(`Extintor #${id} posicionado!`, "ok");
});

/* ── PIN FANTASMA ── */
function criarPinFantasma() {
  pinFantasma?.remove();
  pinFantasma = document.createElement("div");
  pinFantasma.className = "ponto fantasma verde";
  Object.assign(pinFantasma.style, { zIndex:"100", pointerEvents:"none", position:"absolute", display:"none", willChange:"left,top" });
  EL.mapa.appendChild(pinFantasma);
}
let _pinRaf = null;
document.getElementById("mapaContainer").addEventListener("mousemove", e => {
  if (modoAtual !== "colocar" || !pinFantasma) return;
  const r = EL.mapa.getBoundingClientRect();
  const x = (e.clientX - r.left) / viewerScale, y = (e.clientY - r.top) / viewerScale;
  if (!_pinRaf) _pinRaf = requestAnimationFrame(() => {
    pinFantasma.style.display = "block";
    pinFantasma.style.left = x+"px"; pinFantasma.style.top = y+"px";
    _pinRaf = null;
  });
});

/* ── MODO EDIÇÃO ── */
function toggleEdicao() { modoAtual ? sairModoEdicao() : EL.modalEdicao.classList.remove("hidden"); }
function fecharModalEdicao() { EL.modalEdicao.classList.add("hidden"); }

function entrarModoMover() {
  fecharModalEdicao(); modoAtual = "mover";
  EL.btnEdicao.classList.add("ativo"); EL.modoEdBadge.classList.remove("hidden");
  EL.modoEdBadgeTexto.textContent = "Modo mover — arraste os extintores";
  EL.mapaContainer.style.cursor = "grab"; fecharPainel();
  toast("Modo mover ativo", "warn");
}
function entrarModoCriar() {
  fecharModalEdicao();
  EL.novoId.value = proximoIdDisponivel(); validarId(EL.novoId.value);
  EL.modalCadastro.classList.remove("hidden");
  setTimeout(() => EL.novoId.focus(), 100);
}
function sairModoEdicao() { sairModoEdicaoSilencioso(); toast("Modo edição desativado", "ok"); }
function sairModoEdicaoSilencioso() {
  modoAtual = null; novoExtintorDados = null;
  pinFantasma?.remove(); pinFantasma = null;
  EL.btnEdicao.classList.remove("ativo"); EL.modoEdBadge.classList.add("hidden");
  EL.mapaContainer.classList.remove("modo-adicionar");
  EL.mapaContainer.style.cursor = "grab";
}

/* ── CADASTRO ── */
function proximoIdDisponivel() {
  const usados = new Set(Object.keys(dados[galpaoAtivo] || {}));
  let n = 1; while (usados.has(String(n))) n++;
  return String(n);
}
function idJaExiste(val) { return (String(val).trim() in (dados[galpaoAtivo] || {})); }

let _validarTimer = null;
function validarIdDebounce(val) { clearTimeout(_validarTimer); _validarTimer = setTimeout(() => validarId(val), 80); }
function validarId(val) {
  const v = val.trim();
  if (!v) { EL.idInputWrap.classList.remove("id-ok","id-erro"); EL.idFeedback.textContent = ""; EL.idFeedback.className = "id-feedback"; EL.btnConfirmarCadastro.disabled = false; return; }
  const existe = idJaExiste(v);
  EL.idInputWrap.classList.toggle("id-ok",  !existe);
  EL.idInputWrap.classList.toggle("id-erro", existe);
  EL.idFeedback.textContent = existe ? `#${v} já existe neste galpão` : `#${v} disponível`;
  EL.idFeedback.className   = `id-feedback ${existe ? "erro" : "ok"}`;
  EL.btnConfirmarCadastro.disabled = existe;
}
function usarProximoId() { EL.novoId.value = proximoIdDisponivel(); validarId(EL.novoId.value); EL.novoId.focus(); }

function confirmarCadastro() {
  const idRaw = EL.novoId.value.trim(), tipo = EL.novoTipo.value;
  const val   = EL.novaValidade.value, setor = EL.novoSetor.value.trim();
  if (!idRaw)        { toast("Informe a identificação!", "err"); return; }
  if (!val)          { toast("Informe a validade!", "err"); return; }
  if (idJaExiste(idRaw)) { toast(`#${idRaw} já existe!`, "err"); return; }
  novoExtintorDados = { id:idRaw, tipo, validade:val, setor: setor || galpoes[galpaoAtivo]?.nome || "Galpão" };
  EL.modalCadastro.classList.add("hidden");
  EL.novoId.value = EL.novoSetor.value = EL.novaValidade.value = "";
  EL.idFeedback.textContent = ""; EL.idInputWrap.classList.remove("id-ok","id-erro");
  EL.btnConfirmarCadastro.disabled = false;
  modoAtual = "colocar";
  EL.btnEdicao.classList.add("ativo"); EL.modoEdBadge.classList.remove("hidden");
  EL.modoEdBadgeTexto.textContent = "Clique no mapa para posicionar";
  EL.mapaContainer.classList.add("modo-adicionar"); EL.mapaContainer.style.cursor = "crosshair";
  criarPinFantasma(); toast("Clique no mapa para posicionar o extintor", "warn");
}
function cancelarCadastro() { EL.modalCadastro.classList.add("hidden"); novoExtintorDados = null; }

/* ── PAINEL ── */
function abrirPainel(id) {
  if (idAtivo !== null) getPontoEls().get(String(idAtivo))?.classList.remove("selecionado");
  idAtivo = id;
  getPontoEls().get(String(id))?.classList.add("selecionado");
  const ext = dados[galpaoAtivo]?.[id];
  const s   = calcularStatus(ext?.validade);
  EL.dpId.textContent         = `EXTINTOR #${id}`;
  EL.dpNome.textContent       = ext?.tipo || "—";
  EL.dpStatusBar.className    = `dp-status-bar s-${s}`;
  EL.dpStatusIcon.textContent = STATUS_ICON[s];
  EL.dpStatusText.textContent = STATUS_LABEL[s];
  EL.dpDias.textContent       = ext?.validade ? diasLabel(ext.validade) : "—";
  EL.editSetor.value          = ext?.setor    || "";
  EL.editTipo.value           = ext?.tipo     || "Pó Químico ABC";
  EL.editValidade.value       = ext?.validade || "";
  EL.detailPanel.classList.remove("hidden");
}
function fecharPainel() {
  if (idAtivo !== null) getPontoEls().get(String(idAtivo))?.classList.remove("selecionado");
  idAtivo = null; EL.detailPanel.classList.add("hidden");
}
function _syncPainel() {
  const ext = dados[galpaoAtivo]?.[idAtivo]; if (!ext) return;
  const s = calcularStatus(ext.validade);
  EL.dpNome.textContent       = ext.tipo || "—";
  EL.dpStatusBar.className    = `dp-status-bar s-${s}`;
  EL.dpStatusIcon.textContent = STATUS_ICON[s];
  EL.dpStatusText.textContent = STATUS_LABEL[s];
  EL.dpDias.textContent       = ext.validade ? diasLabel(ext.validade) : "—";
}

function salvarEdicao() {
  if (!idAtivo) return;
  const val = EL.editValidade.value;
  if (!val) { toast("Informe a validade!", "err"); return; }
  const ext = dados[galpaoAtivo][idAtivo];
  ext.tipo = EL.editTipo.value; ext.validade = val;
  ext.setor = EL.editSetor.value.trim() || ext.setor;
  salvarStorageImediato(); atualizarPonto(idAtivo); atualizarStats(); atualizarAbaStatus(galpaoAtivo); _syncPainel();
  if (viewAtual === "lista") renderizarLista();
  toast("Extintor atualizado!", "ok");
}
function trocarValidade() {
  if (!idAtivo) return;
  const nova = new Date(); nova.setFullYear(nova.getFullYear() + 1);
  const val  = nova.toISOString().split("T")[0];
  dados[galpaoAtivo][idAtivo].validade = val; EL.editValidade.value = val;
  salvarStorageImediato(); atualizarPonto(idAtivo); atualizarStats(); atualizarAbaStatus(galpaoAtivo); _syncPainel();
  if (viewAtual === "lista") renderizarLista();
  toast("Recarga registrada! Válido por mais 1 ano.", "ok");
}
function removerExtintor() {
  if (!idAtivo) return;
  if (!confirm(`Remover o Extintor #${idAtivo} de ${galpoes[galpaoAtivo]?.nome}?`)) return;
  const id = idAtivo; fecharPainel();
  getPontoEls().get(String(id))?.remove(); getPontoEls().delete(String(id));
  delete dados[galpaoAtivo][id]; delete posicoes[galpaoAtivo][id];
  salvarStorageImediato(); atualizarStats(); atualizarAbaStatus(galpaoAtivo);
  if (viewAtual === "lista") renderizarLista();
  toast(`Extintor #${id} removido`, "warn");
}

/* ── VIEWS ── */
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
    ids = ids.filter(id => String(id).includes(f) || ext[id].tipo.toLowerCase().includes(f) || ext[id].setor.toLowerCase().includes(f));
  }
  if (!ids.length) { EL.listaContainer.innerHTML = `<div style="color:var(--text3);font-size:14px;padding:20px">Nenhum extintor encontrado.</div>`; return; }
  ids.sort((a,b) => isNaN(a)||isNaN(b) ? a.localeCompare(b) : +a - +b);
  EL.listaContainer.innerHTML = ids.map(id => {
    const e = ext[id], d = calcularDias(e.validade), s = diasToStatus(d);
    const dTx = d===-999?"—":d<0?`${Math.abs(d)}d vencido`:d===0?"Hoje!":`${d}d`;
    return `<div class="lista-card ${s}" onclick="abrirPainelLista('${id}')">
      <div class="lc-header"><span class="lc-id">#${id}</span><span class="lc-badge ${s}">${STATUS_LABEL[s]}</span></div>
      <div class="lc-tipo">${e.tipo}</div><div class="lc-setor">${e.setor}</div>
      <div class="lc-divider"></div>
      <div><span class="lc-validade">Val. ${e.validade||"—"}</span><span class="lc-dias ${s}">${dTx}</span></div>
    </div>`;
  }).join("");
}
function abrirPainelLista(id) {
  setView("mapa"); EL.navItems[0].classList.add("active"); EL.navItems[1].classList.remove("active");
  setTimeout(() => abrirPainel(id), 50);
}

/* ── MISC ── */
function resetZoom() { fitViewer(); }

function toast(msg, tipo = "") {
  const el = document.createElement("div");
  el.className = `toast ${tipo}`; el.textContent = msg;
  EL.toastContainer.appendChild(el);
  setTimeout(() => { el.classList.add("fade-out"); setTimeout(() => el.remove(), 350); }, 3000);
}

function exportarRelatorio() {
  const hoje = new Date().toLocaleDateString("pt-BR");
  const sep  = (n) => "─".repeat(n);
  let txt = `RELATÓRIO DE EXTINTORES — ${hoje}\n${sep(60)}\n\n`;
  Object.keys(galpoes).forEach(gid => {
    txt += `▶ ${galpoes[gid].nome}\n${sep(40)}\n`;
    const ext = dados[gid] || {}, ids = Object.keys(ext);
    if (!ids.length) { txt += "  Nenhum extintor cadastrado.\n\n"; return; }
    ids.sort((a,b)=>isNaN(a)||isNaN(b)?a.localeCompare(b):+a-+b).forEach(id => {
      const e = ext[id], d = calcularDias(e.validade), s = diasToStatus(d);
      const sx = s==="verde"?"✓ EM DIA":s==="amarelo"?"⚠ VENCENDO":"✕ VENCIDO";
      txt += `  #${String(id).padStart(3,"0")} | ${e.tipo.padEnd(18)} | ${e.setor.padEnd(18)} | Val: ${e.validade||"—"} | ${sx} (${d>=0?`${d}d restantes`:`${Math.abs(d)}d vencido`})\n`;
    });
    txt += "\n";
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([txt], { type:"text/plain;charset=utf-8" }));
  a.download = `extintores-${hoje.replace(/\//g,"-")}.txt`;
  a.click(); toast("Relatório exportado!", "ok");
}

/* ── EDITAR GALPÃO ── */
function abrirRenomearGalpao(e, gid) {
  e.stopPropagation();
  const g = galpoes[gid];
  EL.renomearGalpaoId.value = gid; EL.renomearGalpaoNome.value = g?.nome || ""; EL.renomearGalpaoImg.value = g?.imagem || "";
  document.getElementById((g?.fundo||"escuro")==="claro"?"renomearFundoClaro":"renomearFundoEscuro").checked = true;
  EL.modalRenomear.classList.remove("hidden");
  setTimeout(() => { EL.renomearGalpaoNome.focus(); EL.renomearGalpaoNome.select(); }, 100);
}
function fecharModalRenomear() { EL.modalRenomear.classList.add("hidden"); }
function confirmarRenomear() {
  const gid  = EL.renomearGalpaoId.value;
  const nome = EL.renomearGalpaoNome.value.trim();
  if (!nome) { toast("Informe um nome!", "err"); return; }
  galpoes[gid].nome   = nome;
  galpoes[gid].imagem = EL.renomearGalpaoImg.value.trim();
  galpoes[gid].fundo  = document.querySelector('input[name="renomearFundo"]:checked')?.value || "escuro";
  fecharModalRenomear(); salvarStorageImediato();
  if (gid === galpaoAtivo) carregarMapa();
  renderizarAbas(); atualizarStats();
  toast(`${nome} atualizado!`, "ok");
}

/* ── INIT ── */
carregarStorage();
_cacheEls();
renderizarAbas();
carregarMapa();
renderizarPontos();
EL.viewSub.textContent = subtitleAtual();
