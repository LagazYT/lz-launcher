/* LZ Launcher - interface */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const TOKEN = new URLSearchParams(location.search).get("t") || "";
// parâmetros opcionais na URL (usados para gerar as imagens do README): view, nav, theme, game
const QP = new URLSearchParams(location.search);

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5Z"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="m6 15 6-6 6 6"/></svg>',
};

const NAV_TITLES = { all: "Todos os jogos", recompiled: "Recompilados", normal: "Jogos de PC" };
const COL_TITLES = { favorites: "Favoritos", recent: "Jogados recentemente", hidden: "Ocultos" };

const state = {
  lib: { games: [], folders: [], settings: {} },
  revision: -1,
  nav: localGet("nav", "all"),
  col: null,
  query: "",
  sort: localGet("sort", "name"),
  view: localGet("view", "grid"),
  running: {},
  scanning: false,
  current: null,
  update: null,
  updateDismissed: false,
  updateToastShown: false,
};

function localGet(k, d) { try { return localStorage.getItem("lz_" + k) ?? d; } catch { return d; } }
function localSet(k, v) { try { localStorage.setItem("lz_" + k, v); } catch { /* ignore */ } }

/* ---------------- API ---------------- */
async function api(name, ...args) {
  if (window.pywebview && window.pywebview.api && window.pywebview.api[name]) {
    return window.pywebview.api[name](...args);
  }
  const r = await fetch("/api/" + name, { method: "POST", headers: { "Content-Type": "application/json", "X-Token": TOKEN }, body: JSON.stringify(args) });
  if (!r.ok) throw new Error("API " + name + " " + r.status);
  return r.json();
}

/* ---------------- Formatação ---------------- */
function fmtPlaytime(sec, empty = "Nunca jogado") {
  sec = Math.floor(sec || 0);
  if (sec < 60) return sec > 0 ? "menos de 1 min" : empty;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h === 0) return `${m} min`;
  if (h >= 100) return `${h} h`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
function fmtClock(sec) {
  sec = Math.floor(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
}
function fmtAgo(ts, empty = "Nunca") {
  if (!ts) return empty;
  const d = new Date(ts * 1000), now = new Date();
  const days = Math.floor((new Date(now.toDateString()) - new Date(d.toDateString())) / 864e5);
  if (days <= 0) return "Hoje";
  if (days === 1) return "Ontem";
  if (days < 7) return `Há ${days} dias`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDate(ts) { return ts ? new Date(ts * 1000).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : "—"; }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function platformLabel(g) { return g.platform === "Console" ? "Console" : g.platform; }
function kindLabel(g) { return g.kind === "recompiled" ? "Recompilado" : "Jogo de PC"; }
function isRunning(id) { return state.running[id] !== undefined; }
function slug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-"); }
function theme() { return document.documentElement.dataset.theme || "sober"; }
function applyTheme(t) {
  t = t === "neon" ? "neon" : "sober";
  if (document.documentElement.dataset.theme !== t) {
    document.documentElement.dataset.theme = t;
    $("#grid")._html = null; $("#list")._html = null; $("#spotlight").dataset.key = "";
  }
  localSet("theme", t);
}
function badgesHTML(g) {
  const b = [];
  if (g.kind === "recompiled") b.push(`<span class="pbadge recomp">RECOMPILADO</span>`);
  b.push(`<span class="pbadge ${slug(g.platform)}">${esc(platformLabel(g)).toUpperCase()}</span>`);
  return b.join("");
}

function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), kind === "error" ? 6000 : 3000);
}

/* ---------------- Capas ---------------- */
function coverHTML(g, id = "") {
  const idAttr = id ? ` id="${id}"` : "";
  if (!g.cover) return `<div${idAttr} class="cover noart"><span class="ph">${esc(g.name)}</span>`;
  return `<div${idAttr} class="cover"><img class="c-bg" src="${g.cover}" alt="" loading="lazy"><img class="c-fg" src="${g.cover}" alt="" loading="lazy" onload="coverLoaded(this)" onerror="coverError(this)">`;
}
// Capa vertical preenche o card; capa quadrada, horizontal ou ícone aparece inteira sobre fundo desfocado
window.coverLoaded = (img) => {
  const box = img.parentElement;
  const r = img.naturalWidth / img.naturalHeight;
  box.classList.add("loaded");
  if (r > 0.6 && r < 0.78) return;
  box.classList.add("fit");
  if (img.naturalWidth <= 200) box.classList.add("icon");
};
window.coverError = (img) => {
  const box = img.parentElement;
  const name = box.closest("[data-name]")?.dataset.name || "";
  box.classList.add("noart");
  box.querySelectorAll("img").forEach(i => i.remove());
  box.insertAdjacentHTML("afterbegin", `<span class="ph">${esc(name)}</span>`);
};

/* ---------------- Filtro / ordenação ---------------- */
function baseGames() { return state.lib.games; }

function visibleGames() {
  const q = state.query.trim().toLowerCase();
  let list = baseGames().filter(g => {
    if (state.nav !== "all" && g.kind !== state.nav) return false;
    if (state.col === "hidden") { if (!g.hidden) return false; }
    else if (g.hidden) return false;
    if (state.col === "favorites" && !g.favorite) return false;
    if (state.col === "recent" && !g.last_played) return false;
    if (q && !(g.name.toLowerCase().includes(q) || (g.platform || "").toLowerCase().includes(q) || (g.title_id || "").toLowerCase().includes(q))) return false;
    return true;
  });
  const sort = state.col === "recent" ? "recent" : state.sort;
  const byName = (a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
  const by = {
    name: byName,
    recent: (a, b) => (b.last_played || 0) - (a.last_played || 0) || byName(a, b),
    playtime: (a, b) => (b.playtime || 0) - (a.playtime || 0) || byName(a, b),
    added: (a, b) => (b.added || 0) - (a.added || 0) || byName(a, b),
    platform: (a, b) => (a.platform || "").localeCompare(b.platform || "") || byName(a, b),
    kind: (a, b) => a.kind.localeCompare(b.kind) || byName(a, b),
  };
  list.sort(by[sort] || byName);
  if (state.sortDesc) list.reverse();
  return list;
}

/* ---------------- Render ---------------- */
function render() {
  const all = baseGames();
  const shown = all.filter(g => !g.hidden);
  const inNav = g => state.nav === "all" || g.kind === state.nav;
  $("#count-all").textContent = shown.length;
  $("#count-recompiled").textContent = shown.filter(g => g.kind === "recompiled").length;
  $("#count-normal").textContent = shown.filter(g => g.kind === "normal").length;
  $("#count-favorites").textContent = shown.filter(g => g.favorite && inNav(g)).length;
  $("#count-recent").textContent = shown.filter(g => g.last_played && inNav(g)).length;
  $("#count-hidden").textContent = all.filter(g => g.hidden && inNav(g)).length;
  $$(".nav-item[data-nav]").forEach(b => b.classList.toggle("active", b.dataset.nav === state.nav && !state.col));
  $$(".nav-item[data-col]").forEach(b => b.classList.toggle("active", b.dataset.col === state.col));
  $$("#view-toggle button").forEach(b => b.classList.toggle("on", b.dataset.view === state.view));
  $("#size").hidden = state.view !== "grid";

  const list = visibleGames();
  const title = state.col ? COL_TITLES[state.col] + (state.nav !== "all" ? " · " + NAV_TITLES[state.nav] : "") : NAV_TITLES[state.nav];
  $("#view-title").textContent = title;
  const total = list.reduce((s, g) => s + (g.playtime || 0), 0);
  $("#view-sub").textContent = `${list.length} ${list.length === 1 ? "jogo" : "jogos"}` + (total >= 60 ? ` · ${fmtPlaytime(total)} jogadas` : "");

  $("#grid").hidden = state.view !== "grid" || !list.length;
  $("#list").hidden = state.view !== "list" || !list.length;
  if (state.view === "grid") renderGrid(list); else renderList(list);
  renderEmpty(list);
  renderSpotlight(list);
  renderNowPlaying();
  if (state.current) renderDetails();
}

// Destaque "Continue jogando" (só no tema Neon)
function renderSpotlight(list) {
  const el = $("#spotlight");
  const pool = list.filter(g => !g.hidden);
  if (theme() !== "neon" || !pool.length || state.query || state.col === "hidden") { el.hidden = true; el.dataset.key = ""; return; }
  const runningId = Object.keys(state.running).find(id => pool.some(g => g.id === id));
  const played = pool.filter(g => g.last_played).sort((a, b) => b.last_played - a.last_played);
  const g = pool.find(x => x.id === runningId) || played[0] || pool.find(x => x.hero) || pool[0];
  const running = isRunning(g.id);
  const eyebrow = running ? "Jogando agora" : (played[0] === g ? "Continue jogando" : "Destaque da biblioteca");
  const key = [g.id, g.hero, g.cover, running, Math.floor(g.playtime / 60)].join("|");
  el.hidden = false;
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  const bg = g.hero ? `<img class="sp-bg" src="${g.hero}" alt="">` : (g.cover ? `<img class="sp-bg blur" src="${g.cover}" alt="">` : "");
  el.innerHTML = `${bg}<div class="sp-content"><div class="sp-text">
      <div class="sp-eyebrow">${eyebrow}</div>
      <div class="sp-title">${esc(g.name)}</div>
      <div class="sp-sub">${badgesHTML(g)}<span>${fmtPlaytime(g.playtime)}</span><span>Última vez: ${fmtAgo(g.last_played)}</span></div>
      <div class="sp-actions">
        <button class="btn play ${running ? "running" : ""}" data-play="${g.id}">${ICON.play}<span>${running ? "EM EXECUÇÃO" : "JOGAR"}</span></button>
        <button class="btn" data-open="${g.id}">Ver detalhes</button>
      </div></div></div>`;
}

function setHTML(el, html) {
  if (el._html === html) return;
  el.innerHTML = html;
  el._html = html;
}

function renderGrid(list) {
  setHTML($("#grid"), list.map(g => {
    const running = isRunning(g.id);
    const sub = running ? "Jogando agora" : fmtPlaytime(g.playtime);
    return `<article class="card ${g.hidden ? "is-hidden" : ""}" tabindex="0" data-id="${g.id}" data-name="${esc(g.name)}">
      ${coverHTML(g)}
        <div class="badge-row"><span class="pbadge ${slug(g.platform)}">${esc(platformLabel(g)).toUpperCase()}</span>${g.favorite ? '<span class="fav-dot">★</span>' : ""}</div>
        ${running ? `<div class="c-running">Jogando agora</div>` : ""}
        <button class="c-play" data-play="${g.id}">${running ? "Abrir" : ICON.play + "Jogar"}</button>
      </div>
      <div class="card-meta">
        <div class="card-title" title="${esc(g.name)}">${g.favorite ? '<span class="fav">★</span>' : ""}${esc(g.name)}</div>
        <div class="card-sub">${esc(platformLabel(g))} · ${sub}</div>
      </div>
    </article>`;
  }).join(""));
}

function renderList(list) {
  const cols = [["name", "Nome"], ["platform", "Plataforma"], ["kind", "Categoria"], ["playtime", "Tempo de jogo"], ["recent", "Última vez"]];
  const head = `<div class="list-head"><span></span>${cols.map(([k, t]) =>
    `<button data-sortcol="${k}" class="${state.sort === k ? "on" : ""} ${k === "kind" ? "c-kind" : ""}">${t}${state.sort === k ? (state.sortDesc ? ICON.up : ICON.down) : ""}</button>`).join("")}<span></span></div>`;
  const rows = list.map(g => {
    const running = isRunning(g.id);
    return `<div class="row ${g.hidden ? "is-hidden" : ""}" data-id="${g.id}" data-name="${esc(g.name)}">
      <div class="thumb">${g.cover ? `<img src="${g.cover}" alt="" loading="lazy" onerror="this.remove()">` : ""}</div>
      <div class="r-name" title="${esc(g.name)}">${g.favorite ? '<span class="fav">★</span>' : ""}${esc(g.name)}</div>
      <div class="r-cell">${esc(platformLabel(g))}</div>
      <div class="r-cell c-kind">${kindLabel(g)}</div>
      <div class="r-cell">${running ? '<span class="r-live">Jogando agora</span>' : fmtPlaytime(g.playtime, "—")}</div>
      <div class="r-cell">${fmtAgo(g.last_played, "—")}</div>
      <button class="r-play" data-play="${g.id}">${running ? "Abrir" : ICON.play + "Jogar"}</button>
    </div>`;
  }).join("");
  setHTML($("#list"), head + rows);
}

function renderEmpty(list) {
  const el = $("#empty");
  if (list.length) { el.hidden = true; return; }
  el.hidden = false;
  if (!state.lib.games.length && !state.scanning) {
    el.innerHTML = `<div class="empty-box"><h2>Sua biblioteca está vazia</h2>
      <p>Adicione a pasta onde ficam seus jogos recompilados ou seus jogos de PC. Cada jogo é reconhecido automaticamente.</p>
      <div class="row-btns"><button class="btn primary" data-act="add-folder">Adicionar pasta de jogos</button><button class="btn" data-act="add-exe">Adicionar pelo executável</button></div></div>`;
  } else {
    const msg = state.query ? `Nenhum jogo encontrado para “${esc(state.query)}”.`
      : state.col === "favorites" ? "Nenhum favorito ainda. Abra um jogo e clique na estrela."
      : state.col === "recent" ? "Nenhum jogo jogado ainda."
      : state.col === "hidden" ? "Nenhum jogo oculto."
      : state.nav === "recompiled" ? "Nenhum jogo recompilado. Adicione a pasta dos seus ports."
      : state.nav === "normal" ? "Nenhum jogo de PC. Adicione uma pasta de jogos ou ative a importação da Steam/Epic nas configurações."
      : "Nada por aqui.";
    el.innerHTML = `<div class="empty-box"><p>${msg}</p></div>`;
  }
}

function renderNowPlaying() {
  const el = $("#now-playing");
  const id = Object.keys(state.running)[0];
  const g = id && state.lib.games.find(x => x.id === id);
  if (!g) { el.hidden = true; return; }
  el.hidden = false;
  el.dataset.open = g.id;
  el.innerHTML = `<div class="np-label">Jogando agora</div><div class="np-name">${esc(g.name)}</div><div class="np-time">${fmtClock(state.running[id])}</div>`;
}

/* ---------------- Detalhes ---------------- */
function openDetails(id) {
  state.current = id;
  $("#library-view").hidden = true;
  $("#details").hidden = false;
  $("#details").scrollTop = 0;
  renderDetails(true);
}
function closeDetails() {
  state.current = null;
  $("#details").hidden = true;
  $("#library-view").hidden = false;
}

function renderDetails(full = false) {
  const g = state.lib.games.find(x => x.id === state.current);
  if (!g) { closeDetails(); return; }
  const running = isRunning(g.id);
  const heroImg = $("#d-hero");
  const key = (g.hero || "") + "|" + (g.cover || "");
  if (full || heroImg.dataset.key !== key) {
    heroImg.dataset.key = key;
    if (g.hero) { heroImg.src = g.hero; heroImg.className = ""; heroImg.hidden = false; }
    else if (g.cover) { heroImg.src = g.cover; heroImg.className = "blur"; heroImg.hidden = false; }
    else heroImg.hidden = true;
    $("#d-cover").innerHTML = coverHTML(g) + "</div>";
    $("#d-cover").dataset.name = g.name;
  }
  $("#d-title").textContent = g.name;
  const sub = [kindLabel(g), platformLabel(g), g.title_id, g.version ? "v" + g.version : null].filter(Boolean);
  $("#d-sub").innerHTML = theme() === "neon" ? badgesHTML(g) + (g.title_id ? `<span class="pbadge">${esc(g.title_id)}</span>` : "") + (g.version ? `<span class="pbadge">v${esc(g.version)}</span>` : "") : esc(sub.join("  ·  "));

  const play = $("#d-play");
  play.classList.toggle("running", running);
  play.innerHTML = running ? `${ICON.stop}<span>Fechar jogo</span>` : `${ICON.play}<span>Jogar</span>`;
  $("#d-alt").hidden = !g.alt_exe;
  $("#d-fav").classList.toggle("on", g.favorite);
  $("#d-fav").title = g.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos";

  $("#d-quick").innerHTML = `
    <div><small>Tempo de jogo</small><b>${fmtPlaytime(g.playtime, "0 min")}</b></div>
    <div><small>${running ? "Sessão atual" : "Última vez"}</small><b class="${running ? "live" : ""}">${running ? fmtClock(state.running[g.id]) : fmtAgo(g.last_played)}</b></div>`;

  const rows = [
    ["Categoria", g.kind === "recompiled" ? "Jogo recompilado (port nativo para Windows)" : "Jogo de PC"],
    ["Plataforma", platformLabel(g) + (g.title_id ? ` (${g.title_id})` : "")],
    ["Tempo de jogo", fmtPlaytime(g.playtime, "Nunca jogado")],
    ["Última vez jogado", g.last_played ? new Date(g.last_played * 1000).toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" }) : "Nunca"],
    ["Sessões", String(g.sessions || 0)],
    ["Adicionado em", fmtDate(g.added)],
    ["Origem", { folder: "Pasta da biblioteca", manual: "Adicionado manualmente", steam: "Steam", epic: "Epic Games" }[g.source] || g.source],
    ["Pasta", g.root],
  ];
  if (g.exe) rows.push(["Executável", g.exe]);
  else if (g.launch_uri) rows.push(["Inicia por", g.source === "steam" ? "Steam" : "Epic Games Launcher"]);
  else rows.push(["Executável", "!Nenhum executável encontrado nessa pasta. Use o botão Editar para escolher o .exe."]);
  if (g.alt_exe) rows.push(["Launcher do port", g.alt_exe]);
  if (g.args) rows.push(["Argumentos", g.args]);
  if (g.art_source && !g.cover_custom) rows.push(["Capa", g.art_source]);
  $("#d-meta").innerHTML = rows.map(([k, v]) => String(v).startsWith("!")
    ? `<dt>${k}</dt><dd class="warn">${esc(v.slice(1))}</dd>` : `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("");
}

/* ---------------- Ações ---------------- */
async function playGame(id) {
  const g = state.lib.games.find(x => x.id === id);
  if (!g) return;
  if (isRunning(id)) { openDetails(id); return; }
  const res = await api("launch", id, false);
  if (res && res.ok) toast(`Iniciando ${g.name}…`, "ok");
  else toast(res?.error || "Não foi possível iniciar o jogo.", "error");
}

async function stopGame(id) {
  const g = state.lib.games.find(x => x.id === id);
  if (!g || !confirm(`Fechar ${g.name}? O progresso que não foi salvo será perdido.`)) return;
  await api("stop_game", id);
  toast("Fechando o jogo…");
}

async function toggleFav(id) {
  const g = state.lib.games.find(x => x.id === id);
  if (!g) return;
  g.favorite = !g.favorite;
  await api("update_game", id, { favorite: g.favorite });
  render();
}

/* ---------------- Modais ---------------- */
function openModal(title, body, foot = "", wide = false) {
  const card = $(".modal-card");
  const reopen = !$("#modal").hidden && card.dataset.key === title;
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = body;
  $("#modal-foot").innerHTML = foot;
  card.classList.toggle("wide", wide);
  if (!reopen) {
    // cada janela lembra o tamanho que o usuário deixou
    card.dataset.key = title;
    const saved = (() => { try { return JSON.parse(localGet("modal:" + title, "null")); } catch { return null; } })();
    card.style.width = saved ? saved.w + "px" : "";
    card.style.height = saved ? saved.h + "px" : "";
  }
  $("#modal").hidden = false;
}

function bindModalResize() {
  const grip = $("#modal-grip"), card = $(".modal-card"), modal = $("#modal");
  grip.addEventListener("pointerdown", e => {
    e.preventDefault();
    try { grip.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const r = card.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
    modal.classList.add("resizing");
    const move = ev => {
      // a janela fica centralizada, então cresce para os dois lados: dobra o deslocamento
      card.style.width = Math.max(360, start.w + (ev.clientX - start.x) * 2) + "px";
      card.style.height = Math.max(220, start.h + (ev.clientY - start.y) * 2) + "px";
    };
    const up = () => {
      grip.removeEventListener("pointermove", move);
      modal.classList.remove("resizing");
      const nr = card.getBoundingClientRect();
      localSet("modal:" + card.dataset.key, JSON.stringify({ w: Math.round(nr.width), h: Math.round(nr.height) }));
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up, { once: true });
  });
  grip.addEventListener("dblclick", () => {
    card.style.width = ""; card.style.height = "";
    try { localStorage.removeItem("lz_modal:" + card.dataset.key); } catch { /* ignore */ }
  });
}
function closeModal() { $("#modal").hidden = true; $("#modal-body").innerHTML = ""; $("#modal-body").onclick = null; $("#modal-body").onchange = null; }

const KIND_OPTS = [
  ["auto", "Automático", "Separa sozinho os ports recompilados dos jogos de PC"],
  ["recompiled", "Recompilados", "Todos os jogos da pasta vão para Recompilados"],
  ["normal", "Jogos de PC", "Todos os jogos da pasta vão para Jogos de PC"],
];

async function addFolderFlow() {
  const path = await api("pick_folder");
  if (!path) return;
  const def = state.nav === "all" ? "auto" : state.nav;
  openModal("Adicionar pasta de jogos",
    `<div class="group-title">Pasta</div><div class="path">${esc(path)}</div>
     <div class="group-title">Categoria dos jogos</div>
     <div class="radio-list">${KIND_OPTS.map(([v, t, d]) => `<label class="radio"><input type="radio" name="kind" value="${v}" ${v === def ? "checked" : ""}><span>${t}<small>${d}</small></span></label>`).join("")}</div>
     <p class="hint" style="margin:14px 0 0">Pode ser uma pasta com vários jogos (cada subpasta vira um jogo) ou a pasta de um jogo só. Nenhum arquivo da pasta é alterado.</p>`,
    `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="confirm-folder">Adicionar</button>`);
  $("#confirm-folder").onclick = async () => {
    const mode = $('input[name="kind"]:checked').value;
    const r = await api("add_folder", path, mode);
    closeModal();
    if (r.ok) toast("Pasta adicionada. Procurando jogos…", "ok"); else toast(r.error, "error");
  };
}

async function addExeFlow() {
  const kind = state.nav === "all" ? "auto" : state.nav;
  const id = await api("add_game_exe", kind);
  if (id) { toast("Jogo adicionado.", "ok"); await reload(); openDetails(id); }
}

function settingsModal() {
  const s = state.lib.settings;
  const folders = state.lib.folders;
  const chk = (key, title, desc) => `<label class="check"><input type="checkbox" data-set="${key}" ${s[key] ? "checked" : ""}><span>${title}<small>${desc}</small></span></label>`;
  openModal("Configurações", `
    <div class="group-title">Pastas de jogos</div>
    <div class="folder-list">${folders.length ? folders.map(f => `
      <div class="folder-item"><span class="fp" title="${esc(f.path)}">${esc(f.path)}</span>
        <select class="select" data-fmode="${esc(f.path)}">${KIND_OPTS.map(([v, t]) => `<option value="${v}" ${f.mode === v ? "selected" : ""}>${t}</option>`).join("")}</select>
        <button class="btn" data-frm="${esc(f.path)}">Remover</button></div>`).join("")
      : `<div class="folder-empty">Nenhuma pasta adicionada.</div>`}</div>
    <button class="btn" data-act="add-folder">Adicionar pasta…</button>

    <div class="sep"></div>
    <div class="group-title">Atualizações</div>
    <p class="hint" style="margin-bottom:8px">Versão instalada: <b style="color:var(--text)">${esc(state.update?.current || "")}</b>${state.update?.mode === "portable" ? " (portable)" : ""}</p>
    <div class="upd-row"><span id="upd-status" class="upd-status"></span>
      <button class="btn" id="upd-check">Procurar atualizações</button>
      <button class="btn primary" id="upd-install" hidden>Atualizar</button></div>
    <pre class="upd-notes" id="upd-notes" hidden></pre>
    ${chk("check_updates", "Verificar atualizações automaticamente", "Ao abrir o app e a cada 6 horas, consulta as versões publicadas no GitHub")}
    ${chk("auto_update", "Baixar atualizações automaticamente", "A versão nova é baixada em segundo plano; você só confirma para reiniciar e instalar")}

    <div class="sep"></div>
    <div class="group-title">Aparência</div>
    <div class="theme-pick">
      <label class="theme-opt"><input type="radio" name="theme" value="sober" ${theme() === "sober" ? "checked" : ""}><span class="swatch sober"><i></i><i></i><i></i></span><span><b>Sóbrio</b><small>Cinzas neutros, visual de launcher de desktop</small></span></label>
      <label class="theme-opt"><input type="radio" name="theme" value="neon" ${theme() === "neon" ? "checked" : ""}><span class="swatch neon"><i></i><i></i><i></i></span><span><b>Neon</b><small>Roxo e ciano com destaque “Continue jogando”, como a primeira versão</small></span></label>
    </div>

    <div class="sep"></div>
    <div class="group-title">Janela</div>
    ${chk("close_to_tray", "Ao fechar, minimizar para a bandeja do sistema", "O LZ Launcher continua rodando perto do relógio e segue contando o tempo de jogo. Para sair de vez, use “Sair” no ícone da bandeja.")}
    ${chk("minimize_on_launch", "Minimizar ao iniciar um jogo", "")}

    <div class="sep"></div>
    <div class="group-title">Biblioteca</div>
    ${chk("import_steam", "Importar jogos instalados pela Steam", "Inclui o tempo de jogo registrado na Steam")}
    ${chk("import_epic", "Importar jogos instalados pela Epic Games", "")}
    ${chk("track_external", "Contar tempo de jogos abertos fora do LZ Launcher", "Funciona enquanto o LZ Launcher estiver aberto ou na bandeja")}

    <div class="sep"></div>
    <div class="group-title">Capas</div>
    ${chk("online_art", "Buscar capas na internet", "Steam, Wikipédia e SteamGridDB. A arte do próprio jogo é usada quando existe")}
    <label class="field" style="margin-top:8px"><span>Chave da API do SteamGridDB (opcional)</span>
      <input class="input" id="sgdb" type="password" value="${esc(s.steamgriddb_key || "")}" placeholder="Cole a chave aqui">
      <small>Capas verticais em alta qualidade para quase qualquer jogo. Gere grátis em steamgriddb.com → Preferências → API.</small></label>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn" id="refresh-art">Atualizar todas as capas</button>
      <button class="btn" id="restore-removed">Restaurar jogos removidos</button>
      <button class="btn" id="open-data">Abrir pasta de dados</button>
    </div>`,
    `<button class="btn primary" data-close>Fechar</button>`);
  const body = $("#modal-body");
  body.onchange = async e => {
    const t = e.target;
    if (t.dataset.set) { s[t.dataset.set] = t.checked; await api("save_settings", { [t.dataset.set]: t.checked }); }
    if (t.name === "theme") { s.theme = t.value; applyTheme(t.value); render(); await api("save_settings", { theme: t.value }); }
    if (t.dataset.fmode) { await api("set_folder_mode", t.dataset.fmode, t.value); toast("Reclassificando os jogos…"); }
  };
  body.onclick = async e => {
    const rm = e.target.closest("[data-frm]");
    if (rm && confirm("Remover essa pasta da biblioteca? Os arquivos dos jogos não são apagados.")) {
      await api("remove_folder", rm.dataset.frm); await reload(); settingsModal();
    }
  };
  $("#sgdb").onchange = async e => { await api("save_settings", { steamgriddb_key: e.target.value.trim() }); toast("Chave salva. Clique em “Atualizar todas as capas”.", "ok"); };
  $("#refresh-art").onclick = async () => { await api("refresh_art", null); toast("Atualizando capas…"); };
  $("#restore-removed").onclick = async () => { await api("restore_removed"); toast("Os jogos removidos voltam após a busca.", "ok"); };
  $("#open-data").onclick = () => api("open_data_folder");
  $("#upd-check").onclick = async () => { $("#upd-status").textContent = "Procurando atualizações…"; state.updateDismissed = false; onUpdateInfo(await api("check_updates")); };
  $("#upd-install").onclick = installUpdate;
  if (state.update) onUpdateInfo(state.update);
}

async function editModal(id) {
  const g = state.lib.games.find(x => x.id === id);
  if (!g) return;
  const exes = [...new Set([g.exe, ...(g.exes || [])].filter(Boolean))];
  openModal("Editar jogo", `
    <label class="field"><span>Nome</span><input class="input" id="e-name" value="${esc(g.name)}"></label>
    <label class="field"><span>Categoria</span><select class="select input" id="e-kind">
      <option value="recompiled" ${g.kind === "recompiled" ? "selected" : ""}>Recompilado</option>
      <option value="normal" ${g.kind === "normal" ? "selected" : ""}>Jogo de PC</option></select></label>
    <label class="field"><span>Executável</span><div class="input-row">
      <select class="select input" id="e-exe">${g.launch_uri ? `<option value="">${g.source === "steam" ? "Iniciar pela Steam" : "Iniciar pela Epic"}</option>` : ""}
      ${exes.map(x => `<option value="${esc(x)}" ${x === g.exe ? "selected" : ""}>${esc(g.root && x.startsWith(g.root) ? "…" + x.slice(g.root.length) : x)}</option>`).join("")}
      ${!exes.length && !g.launch_uri ? `<option value="">(nenhum encontrado)</option>` : ""}</select>
      <button class="btn" id="e-browse">Procurar…</button></div>
      <small>Nos ports, “Play ….exe” abre direto no jogo; o outro .exe abre o launcher do port.</small></label>
    <label class="field"><span>Argumentos de inicialização</span><input class="input" id="e-args" value="${esc(g.args)}" placeholder="opcional"></label>
    <label class="field"><span>Tempo de jogo (horas)</span><input class="input" id="e-time" type="number" min="0" step="0.1" value="${(g.playtime / 3600).toFixed(1)}" style="width:140px"></label>
    <label class="check"><input type="checkbox" id="e-hidden" ${g.hidden ? "checked" : ""}><span>Ocultar da biblioteca<small>Continua acessível em Coleções → Ocultos</small></span></label>`,
    `<button class="btn danger" id="e-remove">Remover da biblioteca</button><span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="e-save">Salvar</button>`);
  $("#e-browse").onclick = async () => {
    const p = await api("pick_exe", id);
    if (p) $("#e-exe").add(new Option(p, p, true, true));
  };
  $("#e-remove").onclick = async () => {
    if (!confirm(`Remover “${g.name}” da biblioteca? Os arquivos do jogo não são apagados.`)) return;
    await api("remove_game", id); closeModal(); closeDetails(); await reload(); toast("Removido da biblioteca.");
  };
  $("#e-save").onclick = async () => {
    const fields = { hidden: $("#e-hidden").checked, args: $("#e-args").value.trim() };
    const name = $("#e-name").value.trim();
    if (name !== g.name) fields.name = name;
    const kind = $("#e-kind").value;
    if (kind !== g.kind) fields.kind = kind;
    const exeVal = $("#e-exe").value;
    if (exeVal !== (g.exe || "")) fields.exe = exeVal;
    const hrs = parseFloat($("#e-time").value);
    if (!isNaN(hrs) && Math.abs(hrs * 3600 - g.playtime) > 180) fields.playtime_hours = hrs;
    await api("update_game", id, fields);
    closeModal(); await reload(); toast("Alterações salvas.", "ok");
  };
}

async function artModal(id) {
  const g = state.lib.games.find(x => x.id === id);
  if (!g) return;
  let kind = "cover";
  let data = null;
  const draw = () => {
    const wide = kind === "hero";
    const local = (data?.local || []).filter(i => wide ? i.w >= i.h * 1.2 : true);
    const online = (data?.online || []).filter(i => i.kind === kind);
    openModal("Capa e imagem de fundo", `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:8px;flex-wrap:wrap">
        <div class="seg" id="a-kind"><button data-k="cover" class="${kind === "cover" ? "on" : ""}">Capa</button><button data-k="hero" class="${kind === "hero" ? "on" : ""}">Imagem de fundo</button></div>
        <div style="display:flex;gap:6px"><button class="btn" id="a-file">Escolher arquivo…</button><button class="btn" id="a-reset">Usar automática</button></div>
      </div>
      <div class="group-title">Imagens no computador</div>
      ${data ? (local.length ? `<div class="art-grid ${wide ? "wide" : ""}">${local.map(i => `<button class="art-opt" data-src="${i.token}" title="${esc(i.path)}"><img src="/local/${i.token}" loading="lazy"><span>${esc(i.name)} · ${i.w}×${i.h}</span></button>`).join("")}</div>` : `<p class="hint">Nenhuma imagem encontrada.</p>`) : `<div class="loading"><span class="spinner"></span>Procurando…</div>`}
      <div class="group-title">Internet</div>
      ${data ? (online.length ? `<div class="art-grid ${wide ? "wide" : ""}">${online.map(i => `<button class="art-opt" data-src="${esc(i.url)}"><img src="${esc(i.url)}" loading="lazy" onerror="this.parentElement.classList.add('bad')"><span>${esc(i.label)}</span></button>`).join("")}</div>` : `<p class="hint">Nada encontrado. Configure a chave do SteamGridDB para mais opções.</p>`) : `<div class="loading"><span class="spinner"></span>Buscando na Steam, Wikipédia e SteamGridDB…</div>`}`,
      "", true);
    $("#a-kind").onclick = e => { const b = e.target.closest("[data-k]"); if (b) { kind = b.dataset.k; draw(); } };
    $("#a-file").onclick = async () => { if (await api("pick_art_file", id, kind)) { await reload(); closeModal(); toast("Imagem atualizada.", "ok"); } };
    $("#a-reset").onclick = async () => { await api("set_art", id, kind, null); await reload(); closeModal(); toast("Imagem automática restaurada."); };
    $("#modal-body").onclick = async e => {
      const b = e.target.closest(".art-opt");
      if (!b) return;
      b.style.opacity = ".5";
      const ok = await api("set_art", id, kind, b.dataset.src);
      if (ok) { await reload(); closeModal(); toast("Imagem atualizada.", "ok"); } else { b.style.opacity = "1"; toast("Não foi possível baixar essa imagem.", "error"); }
    };
  };
  draw();
  data = await api("art_candidates", id);
  if (!$("#modal").hidden) draw();
}

/* ---------------- Atualizações ---------------- */
function updateLabel(u) {
  const v = u.latest?.version;
  return {
    idle: "Verificação automática ligada.",
    checking: "Procurando atualizações…",
    uptodate: `Você está na versão mais recente (${u.current}).`,
    available: `Nova versão ${v} disponível.`,
    downloading: `Baixando a versão ${v}… ${Math.round((u.progress || 0) * 100)}%`,
    ready: `Versão ${v} baixada e pronta para instalar.`,
    installing: "Instalando… o LZ Launcher vai reiniciar.",
    error: u.error || "Erro ao verificar atualizações.",
  }[u.status] || "";
}

function onUpdateInfo(u) {
  state.update = u;
  $("#app-version").textContent = "Versão " + u.current;
  const card = $("#update-card");
  const has = ["available", "downloading", "ready", "installing"].includes(u.status) && u.latest;
  if (!has || state.updateDismissed) { card.hidden = true; }
  else {
    card.hidden = false;
    const busy = u.status === "downloading" || u.status === "installing";
    const btn = u.status === "ready" ? "Reiniciar e atualizar" : "Atualizar agora";
    const html = `<div class="uc-title">Atualização disponível</div>
      <div class="uc-text">${esc(updateLabel(u))}</div>
      ${u.status === "downloading" ? `<div class="uc-bar"><i style="width:${Math.round((u.progress || 0) * 100)}%"></i></div>` : ""}
      <div class="uc-actions">${busy ? "" : `<button class="btn primary" data-update="install">${btn}</button><button class="btn" data-update="later">Depois</button>`}</div>`;
    if (card._html !== html) { card.innerHTML = html; card._html = html; }
    if (!state.updateToastShown) {
      state.updateToastShown = true;
      toast(`Nova versão ${u.latest.version} do LZ Launcher disponível.`, "ok");
    }
  }
  const st = $("#upd-status");
  if (st) {
    st.textContent = updateLabel(u);
    const b = $("#upd-install");
    b.hidden = !(u.status === "available" || u.status === "ready");
    b.textContent = u.status === "ready" ? "Reiniciar e atualizar" : `Atualizar para ${u.latest?.version || ""}`;
    const notes = $("#upd-notes");
    notes.hidden = !(has && u.latest?.notes);
    notes.textContent = u.latest?.notes || "";
  }
}

async function installUpdate() {
  if (Object.keys(state.running).length &&
      !confirm("Há um jogo aberto. Ele continua rodando, mas o tempo desta sessão pode deixar de ser contado enquanto o LZ Launcher reinicia. Atualizar agora?")) return;
  if (state.update?.mode !== "source") toast("Atualizando… o LZ Launcher vai fechar e abrir de novo.");
  const r = await api("install_update");
  if (r && !r.ok && r.error) toast(r.error, "error");
}

/* ---------------- Sincronização ---------------- */
async function reload() {
  const lib = await api("library");
  state.lib = lib;
  state.revision = lib.revision;
  applyTheme(QP.get("theme") || lib.settings.theme);
  render();
}

let lastRunningKeys = "";
async function poll() {
  try {
    const s = await api("status");
    state.running = s.running || {};
    if (s.update) onUpdateInfo(s.update);
    $("#scanbar").hidden = !s.scanning;
    $("#scan-msg").textContent = s.scan_message || "Procurando jogos…";
    $("#btn-rescan").classList.toggle("spin", !!(s.scanning || s.art_busy));
    state.scanning = s.scanning;
    const keys = Object.keys(state.running).sort().join(",");
    if (s.revision !== state.revision) await reload();
    else if (keys !== lastRunningKeys) render();
    else if (keys) {
      renderNowPlaying();
      if (state.current && isRunning(state.current)) renderDetails();
    }
    lastRunningKeys = keys;
  } catch (e) { /* janela fechando */ }
  setTimeout(poll, 1000);
}

/* ---------------- Eventos ---------------- */
function bindEvents() {
  $("#nav").onclick = e => {
    const b = e.target.closest(".nav-item"); if (!b) return;
    if (b.dataset.nav) { state.nav = b.dataset.nav; state.col = null; localSet("nav", state.nav); }
    else state.col = state.col === b.dataset.col ? null : b.dataset.col;
    closeDetails(); render(); $("#scroller").scrollTop = 0;
  };
  $("#search").oninput = e => { state.query = e.target.value; render(); };
  $("#sort").onchange = e => { state.sort = e.target.value; state.sortDesc = false; localSet("sort", state.sort); render(); };
  $("#view-toggle").onclick = e => {
    const b = e.target.closest("[data-view]"); if (!b) return;
    state.view = b.dataset.view; localSet("view", state.view); render();
  };
  $("#size").oninput = e => { document.documentElement.style.setProperty("--card", e.target.value + "px"); localSet("size", e.target.value); };
  $("#btn-add").onclick = e => { e.stopPropagation(); $("#menu-add").hidden = !$("#menu-add").hidden; };
  $("#btn-rescan").onclick = async () => { await api("rescan", false); toast("Procurando jogos novos…"); };
  $("#btn-settings").onclick = settingsModal;
  $("#modal-close").onclick = closeModal;
  // fecha ao clicar fora, mas não quando o clique termina fora depois de arrastar/selecionar dentro da janela
  let downOnBackdrop = false;
  $("#modal").onpointerdown = e => { downOnBackdrop = e.target.id === "modal"; };
  $("#modal").onclick = e => { if ((e.target.id === "modal" && downOnBackdrop) || e.target.closest("[data-close]")) closeModal(); };
  $("#d-back").onclick = closeDetails;
  $("#d-play").onclick = () => isRunning(state.current) ? stopGame(state.current) : playGame(state.current);
  $("#d-alt").onclick = async () => {
    const r = await api("launch", state.current, true);
    r.ok ? toast("Abrindo o launcher do port…", "ok") : toast(r.error, "error");
  };
  $("#d-fav").onclick = () => toggleFav(state.current);
  $("#d-folder").onclick = () => api("open_folder", state.current);
  $("#d-art").onclick = () => artModal(state.current);
  $("#d-edit").onclick = () => editModal(state.current);

  document.addEventListener("click", e => {
    if (!e.target.closest(".menu-wrap")) $("#menu-add").hidden = true;
    const act = e.target.closest("[data-act]");
    if (act) {
      $("#menu-add").hidden = true;
      if (act.dataset.act === "add-folder") { closeModal(); addFolderFlow(); }
      if (act.dataset.act === "add-exe") { closeModal(); addExeFlow(); }
      return;
    }
    const up = e.target.closest("[data-update]");
    if (up) {
      if (up.dataset.update === "install") installUpdate();
      else { state.updateDismissed = true; $("#update-card").hidden = true; }
      return;
    }
    const sc = e.target.closest("[data-sortcol]");
    if (sc) {
      const k = sc.dataset.sortcol;
      if (state.sort === k) state.sortDesc = !state.sortDesc; else { state.sort = k; state.sortDesc = false; }
      if (["name", "recent", "playtime", "platform", "added"].includes(k)) { $("#sort").value = k; localSet("sort", k); }
      render(); return;
    }
    const p = e.target.closest("[data-play]");
    if (p) { e.stopPropagation(); playGame(p.dataset.play); return; }
    const o = e.target.closest("[data-open]");
    if (o) { openDetails(o.dataset.open); return; }
    const item = e.target.closest(".card, .row");
    if (item) openDetails(item.dataset.id);
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      if (!$("#modal").hidden) closeModal();
      else if (state.current) closeDetails();
      else if (state.query) { $("#search").value = ""; state.query = ""; render(); }
    }
    if ((e.key === "f" && e.ctrlKey) || (e.key === "/" && document.activeElement.tagName !== "INPUT")) { e.preventDefault(); closeDetails(); $("#search").focus(); }
    if (e.key === "Enter" && document.activeElement.classList.contains("card")) openDetails(document.activeElement.dataset.id);
  });
  document.addEventListener("contextmenu", e => { if (!e.target.closest("input")) e.preventDefault(); });
}

async function boot() {
  $("#sort").value = state.sort;
  const size = localGet("size", "170");
  $("#size").value = size;
  document.documentElement.style.setProperty("--card", size + "px");
  if (QP.get("view")) state.view = QP.get("view");
  if (QP.get("nav")) state.nav = QP.get("nav");
  bindEvents();
  bindModalResize();
  await reload();
  if (QP.get("game")) {
    const g = state.lib.games.find(x => x.name.toLowerCase().includes(QP.get("game").toLowerCase()));
    if (g) openDetails(g.id);
  }
  poll();
}

if (window.pywebview) boot();
else {
  let started = false;
  const go = () => { if (!started) { started = true; boot(); } };
  window.addEventListener("pywebviewready", go);
  setTimeout(() => { if (!window.pywebview) go(); }, 600);
}
