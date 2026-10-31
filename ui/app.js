/* LZ Launcher - interface */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const TOKEN = new URLSearchParams(location.search).get("t") || "";
// parâmetros opcionais na URL (usados para gerar as imagens do README): view, nav, theme, game, page, lang, tv
const QP = new URLSearchParams(location.search);

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5Z"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="m6 15 6-6 6 6"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
};

const THEMES = ["sober", "neon", "cyberpunk", "midnight", "xbox", "ps5"];
const AMBIENT_THEMES = ["cyberpunk", "midnight", "xbox", "ps5"];
const SPOTLIGHT_THEMES = ["neon", "xbox", "ps5"];

const state = {
  lib: { games: [], folders: [], settings: {} },
  revision: -1,
  page: "library",   // library | stats
  nav: "all",        // nav, sort e view são carregados das preferências salvas no boot()
  col: null,
  query: "",
  sort: "name",
  view: "grid",
  running: {},
  scanning: false,
  current: null,
  update: null,
  updateDismissed: false,
  updateToastShown: false,
  tv: false,
  pad: null,
};

// Preferências da interface (tamanho das capas, grade/lista, ordem, tamanho das janelas...).
// Ficam salvas pelo app junto com a biblioteca: o localStorage do WebView não serve, porque a
// interface abre numa porta diferente a cada vez e o navegador trata cada porta como outro site.
let UI = {};
const uiTimers = {};
function localGet(k, d) {
  if (Object.prototype.hasOwnProperty.call(UI, k)) return UI[k];
  try { return localStorage.getItem("lz_" + k) ?? d; } catch { return d; }
}
function localSet(k, v) {
  UI[k] = v;
  try { localStorage.setItem("lz_" + k, v); } catch { /* ignore */ }
  clearTimeout(uiTimers[k]);
  uiTimers[k] = setTimeout(() => api("set_ui_pref", k, v).catch(() => { }), 350);
}

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
function fmtPlaytime(sec, empty) {
  sec = Math.floor(sec || 0);
  if (sec < 60) return sec > 0 ? t("menos de 1 min") : (empty ?? t("Nunca jogado"));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h === 0) return `${m} min`;
  if (h >= 100) return `${h} h`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
function fmtHours(sec) {
  const h = (sec || 0) / 3600;
  if (h === 0) return "0 h";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  return h < 10 ? `${h.toFixed(1).replace(".", LANG === "en" ? "." : ",")} h` : `${Math.round(h)} h`;
}
function fmtClock(sec) {
  sec = Math.floor(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
}
function fmtAgo(ts, empty) {
  if (!ts) return empty ?? t("Nunca");
  const d = new Date(ts * 1000), now = new Date();
  const days = Math.floor((new Date(now.toDateString()) - new Date(d.toDateString())) / 864e5);
  if (days <= 0) return t("Hoje");
  if (days === 1) return t("Ontem");
  if (days < 7) return t("Há {n} dias", { n: days });
  return d.toLocaleDateString(LOCALE(), { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDate(ts) { return ts ? new Date(ts * 1000).toLocaleDateString(LOCALE(), { day: "2-digit", month: "short", year: "numeric" }) : "—"; }
function fmtTime(ts) { return new Date(ts * 1000).toLocaleTimeString(LOCALE(), { hour: "2-digit", minute: "2-digit" }); }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function platformLabel(g) { return g.platform === "Console" ? t("Console") : g.platform; }
function kindLabel(g) { return g.kind === "recompiled" ? t("Recompilado") : t("Jogo de PC"); }
function sourceLabel(s) {
  return {
    folder: t("Pasta da biblioteca"), manual: t("Adicionado manualmente"), steam: "Steam", epic: "Epic Games",
    gog: "GOG", ubisoft: "Ubisoft Connect", ea: "EA app", battlenet: "Battle.net", xbox: "Xbox (Game Pass)",
  }[s] || s;
}
function isRunning(id) { return state.running[id] !== undefined; }
function slug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-"); }
function gameById(id) { return state.lib.games.find(x => x.id === id); }
function theme() { return document.documentElement.dataset.theme || "sober"; }
function applyTheme(th) {
  th = THEMES.includes(th) ? th : "sober";
  if (document.documentElement.dataset.theme !== th) {
    document.documentElement.dataset.theme = th;
    $("#grid")._html = null; $("#list")._html = null; $("#spotlight").dataset.key = "";
  }
  localSet("theme", th);
}
function badgesHTML(g) {
  const b = [];
  if (g.kind === "recompiled") b.push(`<span class="pbadge recomp">${t("RECOMPILADO")}</span>`);
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

// Dica flutuante usada pelos gráficos (elementos com data-tip)
function bindTooltips() {
  const tip = $("#tip");
  document.addEventListener("mousemove", e => {
    const el = e.target.closest("[data-tip]");
    if (!el) { tip.hidden = true; return; }
    tip.innerHTML = el.dataset.tip;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
    tip.style.left = x + "px"; tip.style.top = y + "px";
  });
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

// Fundo dinâmico (tema Cyberpunk): a arte do jogo em foco
let ambientId = null;
function setAmbient(g) {
  if (!g || ambientId === g.id) return;
  ambientId = g.id;
  const src = g.hero || g.cover;
  document.documentElement.style.setProperty("--ambient", src ? `url("${src}")` : "none");
}

// total de conquistas desbloqueadas (aparece como "pontuação" no perfil do tema Xbox)
function achScore() { return state.lib.games.reduce((s, g) => s + (g.ach?.unlocked || 0), 0); }
// nome escolhido pelo usuário (no lugar de "LZ Launcher" na barra lateral e no Modo TV)
function profileName() { return (state.lib.settings.profile_name || "").trim() || "LZ Launcher"; }
function renderProfileName() {
  const n = profileName();
  for (const id of ["#wm-name", "#tv-name"]) { const el = $(id); if (el && el.textContent !== n) el.textContent = n; }
}
function renderScore() {
  renderProfileName();
  const html = `<svg viewBox="0 0 24 24"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>${achScore().toLocaleString(LOCALE())}`;
  for (const id of ["#wm-score", "#tv-score"]) { const el = $(id); if (el && el._html !== html) { el.innerHTML = html; el._html = html; } }
}

/* ---------------- Filtro / ordenação ---------------- */
function sortGames(list, sort) {
  const byName = (a, b) => a.name.localeCompare(b.name, LOCALE(), { sensitivity: "base" });
  const by = {
    name: byName,
    recent: (a, b) => (b.last_played || 0) - (a.last_played || 0) || byName(a, b),
    playtime: (a, b) => (b.playtime || 0) - (a.playtime || 0) || byName(a, b),
    added: (a, b) => (b.added || 0) - (a.added || 0) || byName(a, b),
    platform: (a, b) => (a.platform || "").localeCompare(b.platform || "") || byName(a, b),
    kind: (a, b) => a.kind.localeCompare(b.kind) || byName(a, b),
  };
  return list.sort(by[sort] || byName);
}

function visibleGames() {
  const q = state.query.trim().toLowerCase();
  let list = state.lib.games.filter(g => {
    if (state.nav !== "all" && g.kind !== state.nav) return false;
    if (state.col === "hidden") { if (!g.hidden) return false; }
    else if (g.hidden) return false;
    if (state.col === "favorites" && !g.favorite) return false;
    if (state.col === "recent" && !g.last_played) return false;
    if (q && !(g.name.toLowerCase().includes(q) || (g.platform || "").toLowerCase().includes(q) || (g.title_id || "").toLowerCase().includes(q)
      || (g.info?.genres || []).some(x => x.toLowerCase().includes(q)))) return false;
    return true;
  });
  sortGames(list, state.col === "recent" ? "recent" : state.sort);
  if (state.sortDesc) list.reverse();
  return list;
}

/* ---------------- Render ---------------- */
function navTitle() {
  const NAV = { all: t("Todos os jogos"), recompiled: t("Recompilados"), normal: t("Jogos de PC") };
  const COL = { favorites: t("Favoritos"), recent: t("Jogados recentemente"), hidden: t("Ocultos") };
  return state.col ? COL[state.col] + (state.nav !== "all" ? " · " + NAV[state.nav] : "") : NAV[state.nav];
}

function render() {
  const all = state.lib.games;
  const shown = all.filter(g => !g.hidden);
  const inNav = g => state.nav === "all" || g.kind === state.nav;
  $("#count-all").textContent = shown.length;
  renderScore();
  $("#count-recompiled").textContent = shown.filter(g => g.kind === "recompiled").length;
  $("#count-normal").textContent = shown.filter(g => g.kind === "normal").length;
  $("#count-favorites").textContent = shown.filter(g => g.favorite && inNav(g)).length;
  $("#count-recent").textContent = shown.filter(g => g.last_played && inNav(g)).length;
  $("#count-hidden").textContent = all.filter(g => g.hidden && inNav(g)).length;
  const lib = state.page === "library";
  $$(".nav-item[data-nav]").forEach(b => b.classList.toggle("active", lib && b.dataset.nav === state.nav && !state.col));
  $$(".nav-item[data-col]").forEach(b => b.classList.toggle("active", lib && b.dataset.col === state.col));
  $$(".nav-item[data-page]").forEach(b => b.classList.toggle("active", b.dataset.page === state.page));
  $$("#view-toggle button").forEach(b => b.classList.toggle("on", b.dataset.view === state.view));
  $("#size").hidden = state.view !== "grid";

  const list = visibleGames();
  $("#view-title").textContent = navTitle();
  const total = list.reduce((s, g) => s + (g.playtime || 0), 0);
  $("#view-sub").textContent = t(list.length === 1 ? "{n} jogo" : "{n} jogos", { n: list.length })
    + (total >= 60 ? " · " + t("{t} jogadas", { t: fmtPlaytime(total) }) : "");

  $("#grid").hidden = state.view !== "grid" || !list.length;
  $("#list").hidden = state.view !== "list" || !list.length;
  if (state.view === "grid") renderGrid(list); else renderList(list);
  renderEmpty(list);
  renderSpotlight(list);
  renderNowPlaying();
  if (AMBIENT_THEMES.includes(theme()) && !ambientId) setAmbient(list.find(g => g.last_played) || list[0]);
  if (state.current) renderDetails();
  if (state.page === "stats") renderStats();
  if (state.page === "trophies" && !state.current) renderTrophiesPage(true);
  if (state.tv) renderTV();
}

// Destaque "Continue jogando" (só no tema Neon)
function renderSpotlight(list) {
  const el = $("#spotlight");
  const pool = list.filter(g => !g.hidden);
  if (!SPOTLIGHT_THEMES.includes(theme()) || !pool.length || state.query || state.col === "hidden") { el.hidden = true; el.dataset.key = ""; return; }
  const runningId = Object.keys(state.running).find(id => pool.some(g => g.id === id));
  const played = pool.filter(g => g.last_played).sort((a, b) => b.last_played - a.last_played);
  const g = pool.find(x => x.id === runningId) || played[0] || pool.find(x => x.hero) || pool[0];
  const running = isRunning(g.id);
  const eyebrow = running ? t("Jogando agora") : (played[0] === g ? t("Continue jogando") : t("Destaque da biblioteca"));
  const key = [g.id, g.hero, g.cover, running, Math.floor(g.playtime / 60), LANG].join("|");
  el.hidden = false;
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  const bg = g.hero ? `<img class="sp-bg" src="${g.hero}" alt="">` : (g.cover ? `<img class="sp-bg blur" src="${g.cover}" alt="">` : "");
  el.innerHTML = `${bg}<div class="sp-content"><div class="sp-text">
      <div class="sp-eyebrow">${eyebrow}</div>
      <div class="sp-title">${esc(g.name)}</div>
      <div class="sp-sub">${badgesHTML(g)}<span>${fmtPlaytime(g.playtime)}</span><span>${t("Última vez")}: ${fmtAgo(g.last_played)}</span></div>
      <div class="sp-actions">
        <button class="btn play ${running ? "running" : ""}" data-play="${g.id}">${ICON.play}<span>${running ? t("EM EXECUÇÃO") : t("JOGAR")}</span></button>
        <button class="btn" data-open="${g.id}">${t("Ver detalhes")}</button>
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
    const sub = running ? t("Jogando agora") : fmtPlaytime(g.playtime);
    return `<article class="card ${g.hidden ? "is-hidden" : ""}" tabindex="0" data-id="${g.id}" data-name="${esc(g.name)}">
      ${coverHTML(g)}
        <div class="badge-row"><span class="pbadge ${slug(g.platform)}">${esc(platformLabel(g)).toUpperCase()}</span>${g.favorite ? '<span class="fav-dot">★</span>' : ""}</div>
        ${running ? `<div class="c-running">${t("Jogando agora")}</div>` : ""}
        ${trophyBadge(g)}
        <button class="c-play" data-play="${g.id}" tabindex="-1">${running ? t("Abrir") : ICON.play + t("Jogar")}</button>
      </div>
      <div class="card-meta">
        <div class="card-title" title="${esc(g.name)}">${g.favorite ? '<span class="fav">★</span>' : ""}${esc(g.name)}</div>
        <div class="card-sub">${esc(platformLabel(g))} · ${sub}</div>
      </div>
    </article>`;
  }).join(""));
}

function renderList(list) {
  const cols = [["name", t("Nome")], ["platform", t("Plataforma")], ["kind", t("Categoria")], ["playtime", t("Tempo de jogo")], ["recent", t("Última vez")]];
  const head = `<div class="list-head"><span></span>${cols.map(([k, label]) =>
    `<button data-sortcol="${k}" tabindex="-1" class="${state.sort === k ? "on" : ""} ${k === "kind" ? "c-kind" : ""}">${label}${state.sort === k ? (state.sortDesc ? ICON.up : ICON.down) : ""}</button>`).join("")}<span></span></div>`;
  const rows = list.map(g => {
    const running = isRunning(g.id);
    return `<div class="row ${g.hidden ? "is-hidden" : ""}" tabindex="0" data-id="${g.id}" data-name="${esc(g.name)}">
      <div class="thumb">${g.cover ? `<img src="${g.cover}" alt="" loading="lazy" onerror="this.remove()">` : ""}</div>
      <div class="r-name" title="${esc(g.name)}">${g.favorite ? '<span class="fav">★</span>' : ""}${esc(g.name)}</div>
      <div class="r-cell">${esc(platformLabel(g))}</div>
      <div class="r-cell c-kind">${kindLabel(g)}</div>
      <div class="r-cell">${running ? `<span class="r-live">${t("Jogando agora")}</span>` : fmtPlaytime(g.playtime, "—")}</div>
      <div class="r-cell">${fmtAgo(g.last_played, "—")}</div>
      <button class="r-play" data-play="${g.id}" tabindex="-1">${running ? t("Abrir") : ICON.play + t("Jogar")}</button>
    </div>`;
  }).join("");
  setHTML($("#list"), head + rows);
}

function renderEmpty(list) {
  const el = $("#empty");
  if (list.length) { el.hidden = true; return; }
  el.hidden = false;
  if (!state.lib.games.length && !state.scanning) {
    el.innerHTML = `<div class="empty-box"><h2>${t("Sua biblioteca está vazia")}</h2>
      <p>${t("Adicione a pasta onde ficam seus jogos recompilados ou seus jogos de PC. Cada jogo é reconhecido automaticamente.")}</p>
      <div class="row-btns"><button class="btn primary" data-act="add-folder">${t("Adicionar pasta de jogos")}</button><button class="btn" data-act="add-exe">${t("Adicionar pelo executável")}</button></div></div>`;
  } else {
    const msg = state.query ? t("Nenhum jogo encontrado para “{q}”.", { q: esc(state.query) })
      : state.col === "favorites" ? t("Nenhum favorito ainda. Abra um jogo e clique na estrela.")
      : state.col === "recent" ? t("Nenhum jogo jogado ainda.")
      : state.col === "hidden" ? t("Nenhum jogo oculto.")
      : state.nav === "recompiled" ? t("Nenhum jogo recompilado. Adicione a pasta dos seus ports.")
      : state.nav === "normal" ? t("Nenhum jogo de PC. Adicione uma pasta de jogos ou ative a importação das lojas nas configurações.")
      : t("Nada por aqui.");
    el.innerHTML = `<div class="empty-box"><p>${msg}</p></div>`;
  }
}

function renderNowPlaying() {
  const el = $("#now-playing");
  const id = Object.keys(state.running)[0];
  const g = id && gameById(id);
  if (!g) { el.hidden = true; return; }
  el.hidden = false;
  el.dataset.open = g.id;
  el.innerHTML = `<div class="np-label">${t("Jogando agora")}</div><div class="np-name">${esc(g.name)}</div><div class="np-time">${fmtClock(state.running[id])}</div>`;
}

/* ---------------- Páginas ---------------- */
function showPage(page) {
  state.page = page;
  state.current = null;
  $("#details").hidden = true;
  $("#library-view").hidden = page !== "library";
  $("#stats-view").hidden = page !== "stats";
  $("#trophies-view").hidden = page !== "trophies";
  render();
}

/* ---------------- Detalhes ---------------- */
function openDetails(id) {
  state.current = id;
  $("#library-view").hidden = true;
  $("#stats-view").hidden = true;
  $("#trophies-view").hidden = true;
  $("#details").hidden = false;
  $("#details").scrollTop = 0;
  renderDetails(true);
  const g = gameById(id);
  if (g) setAmbient(g);
}
function closeDetails() {
  state.current = null;
  $("#details").hidden = true;
  $("#library-view").hidden = state.page !== "library";
  $("#stats-view").hidden = state.page !== "stats";
  $("#trophies-view").hidden = state.page !== "trophies";
}

function infoHTML(g) {
  const i = g.info;
  if (!i) return `<p class="hint">${t("Buscando descrição, gênero e nota… (precisa de internet)")}</p>`;
  const meta = i.metacritic ? `<a class="meta-score ${i.metacritic >= 75 ? "good" : i.metacritic >= 50 ? "mid" : "bad"}" ${i.metacritic_url ? `data-url="${esc(i.metacritic_url)}"` : ""} title="Metacritic">${i.metacritic}</a>` : "";
  const rows = [];
  if (i.developers?.length) rows.push([t("Desenvolvedora"), i.developers.join(", ")]);
  if (i.publishers?.length) rows.push([t("Publicadora"), i.publishers.join(", ")]);
  if (i.release || i.year) rows.push([t("Lançamento"), i.release || String(i.year)]);
  return `
    ${i.genres?.length ? `<div class="genres">${i.genres.map(x => `<span class="genre">${esc(x)}</span>`).join("")}</div>` : ""}
    ${i.description ? `<p class="desc">${esc(i.description)}</p>` : ""}
    <div class="info-row">
      ${meta ? `<div class="meta-box">${meta}<span>Metacritic</span></div>` : ""}
      <dl class="info-dl">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
    </div>
    <div class="info-src">${t("Fonte")}: ${esc(i.source || "")}${i.wiki_url ? ` · <a data-url="${esc(i.wiki_url)}">${t("Ler mais")}</a>` : ""}</div>`;
}

function sessionsHTML(g) {
  const hist = [...(g.history || [])].reverse();
  const live = isRunning(g.id);
  if (!hist.length && !live) return `<p class="hint">${t("Nenhuma sessão registrada ainda. O histórico é gravado a cada vez que você joga.")}</p>`;
  const rows = [];
  if (live) rows.push(`<div class="sess live"><span>${t("Agora")}</span><span>${fmtTime(Date.now() / 1000 - state.running[g.id])} – …</span><b>${fmtClock(state.running[g.id])}</b></div>`);
  hist.slice(0, 12).forEach(s => rows.push(`<div class="sess"><span>${fmtDate(s.s)}</span><span>${fmtTime(s.s)} – ${fmtTime(s.e)}</span><b>${fmtPlaytime(s.e - s.s)}</b></div>`));
  return `<div class="sess-list">${rows.join("")}</div>${hist.length > 12 ? `<p class="hint" style="margin-top:8px">${t("Mostrando as 12 mais recentes de {n} sessões.", { n: hist.length })}</p>` : ""}`;
}

function renderDetails(full = false) {
  const g = gameById(state.current);
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
  const sub = [kindLabel(g), platformLabel(g), g.title_id, g.version ? "v" + g.version : null, g.info?.year].filter(Boolean);
  $("#d-sub").innerHTML = ["neon", "cyberpunk"].includes(theme())
    ? badgesHTML(g) + (g.title_id ? `<span class="pbadge">${esc(g.title_id)}</span>` : "") + (g.version ? `<span class="pbadge">v${esc(g.version)}</span>` : "")
    : esc(sub.join("  ·  "));

  const play = $("#d-play");
  play.classList.toggle("running", running);
  play.innerHTML = running ? `${ICON.stop}<span>${t("Fechar jogo")}</span>` : `${ICON.play}<span>${t("Jogar")}</span>`;
  $("#d-alt").hidden = !g.alt_exe;
  $("#d-fav").classList.toggle("on", g.favorite);
  $("#d-fav").title = g.favorite ? t("Remover dos favoritos") : t("Adicionar aos favoritos");

  $("#d-quick").innerHTML = `
    <div><small>${t("Tempo de jogo")}</small><b>${fmtPlaytime(g.playtime, "0 min")}</b></div>
    <div><small>${running ? t("Sessão atual") : t("Última vez")}</small><b class="${running ? "live" : ""}">${running ? fmtClock(state.running[g.id]) : fmtAgo(g.last_played)}</b></div>`;

  const infoKey = JSON.stringify(g.info || null) + LANG;
  if (full || $("#d-info")._key !== infoKey) { $("#d-info").innerHTML = infoHTML(g); $("#d-info")._key = infoKey; }
  const sessKey = (g.history || []).length + "|" + running + "|" + (running ? Math.floor(state.running[g.id] / 5) : "") + LANG;
  if (full || $("#d-sessions")._key !== sessKey) { $("#d-sessions").innerHTML = sessionsHTML(g); $("#d-sessions")._key = sessKey; }
  renderDetailsTrophies(g, full);

  const rows = [
    [t("Categoria"), g.kind === "recompiled" ? t("Jogo recompilado (port nativo para Windows)") : t("Jogo de PC")],
    [t("Plataforma"), platformLabel(g) + (g.title_id ? ` (${g.title_id})` : "")],
    [t("Tempo de jogo"), fmtPlaytime(g.playtime)],
    [t("Última vez jogado"), g.last_played ? new Date(g.last_played * 1000).toLocaleString(LOCALE(), { dateStyle: "long", timeStyle: "short" }) : t("Nunca")],
    [t("Sessões"), String(g.sessions || 0)],
    [t("Adicionado em"), fmtDate(g.added)],
    [t("Origem"), sourceLabel(g.source)],
    [t("Pasta"), g.root],
  ];
  if (g.exe) rows.push([t("Executável"), g.exe]);
  else if (g.launch_uri) rows.push([t("Inicia por"), sourceLabel(g.source)]);
  else rows.push([t("Executável"), "!" + t("Nenhum executável encontrado nessa pasta. Use o botão Editar para escolher o .exe.")]);
  if (g.alt_exe) rows.push([t("Launcher do port"), g.alt_exe]);
  if (g.args) rows.push([t("Argumentos"), g.args]);
  if (g.art_source && !g.cover_custom) rows.push([t("Capa"), g.art_source]);
  $("#d-meta").innerHTML = rows.map(([k, v]) => String(v).startsWith("!")
    ? `<dt>${k}</dt><dd class="warn">${esc(v.slice(1))}</dd>` : `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("");
}

/* ---------------- Estatísticas ---------------- */
function allSessions() {
  const out = [];
  for (const g of state.lib.games) for (const s of g.history || []) out.push({ g, s: s.s, e: s.e });
  const now = Date.now() / 1000;
  for (const [id, sec] of Object.entries(state.running)) {
    const g = gameById(id);
    if (g) out.push({ g, s: now - sec, e: now, live: true });
  }
  return out.sort((a, b) => b.s - a.s);
}

// Soma os segundos jogados em cada dia (dividindo sessões que passam da meia-noite)
function secondsPerDay(sessions, days) {
  const res = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const a = d.getTime() / 1000, b = a + 86400;
    let sum = 0;
    for (const s of sessions) sum += Math.max(0, Math.min(b, s.e) - Math.max(a, s.s));
    res.push({ day: d, sec: sum });
  }
  return res;
}

function niceMax(v) {
  if (v <= 0) return 1;
  const steps = [0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24];
  return steps.find(x => x >= v) || Math.ceil(v);
}

function barChartHTML(days) {
  const maxH = niceMax(Math.max(...days.map(d => d.sec / 3600)));
  const ticks = [maxH, maxH / 2, 0];
  const fmtTick = h => h === 0 ? "0" : (h < 1 ? `${Math.round(h * 60)}m` : `${+h.toFixed(1)}h`);
  const bars = days.map((d, i) => {
    const h = d.sec / 3600;
    const pct = Math.min(100, (h / maxH) * 100);
    const label = d.day.toLocaleDateString(LOCALE(), { weekday: "short", day: "2-digit", month: "short" });
    const showX = i === 0 || i === days.length - 1 || d.day.getDate() === 1 || i % 7 === (days.length - 1) % 7;
    return `<div class="bar-col" data-tip="<b>${esc(label)}</b><br>${d.sec ? fmtPlaytime(d.sec) : t("Sem jogo")}">
      <div class="bar" style="height:${pct}%"></div>
      <span class="bar-x">${showX ? d.day.toLocaleDateString(LOCALE(), { day: "2-digit", month: "2-digit" }) : ""}</span></div>`;
  }).join("");
  return `<div class="chart">
    <div class="chart-y">${ticks.map(v => `<span>${fmtTick(v)}</span>`).join("")}</div>
    <div class="chart-plot"><div class="chart-grid"><i></i><i></i><i></i></div><div class="bars">${bars}</div></div>
  </div>`;
}

function hbarsHTML(items, withThumb) {
  const max = Math.max(...items.map(x => x.value), 1);
  return `<div class="hbars">${items.map(x => `
    <div class="hbar" ${x.id ? `data-open="${x.id}"` : ""} data-tip="<b>${esc(x.label)}</b><br>${fmtPlaytime(x.value)}">
      ${withThumb ? `<div class="hb-thumb">${x.cover ? `<img src="${x.cover}" alt="" loading="lazy" onerror="this.remove()">` : ""}</div>` : ""}
      <div class="hb-main"><div class="hb-top"><span class="hb-label">${esc(x.label)}</span><span class="hb-val">${fmtHours(x.value)}</span></div>
      <div class="hb-track"><div class="hb-fill" style="width:${Math.max(1.5, (x.value / max) * 100)}%"></div></div></div>
    </div>`).join("")}</div>`;
}

function renderStats() {
  const el = $("#stats-body");
  const games = state.lib.games;
  const sessions = allSessions();
  const total = games.reduce((s, g) => s + (g.playtime || 0), 0);
  const played = games.filter(g => g.playtime > 0).length;
  const sessCount = games.reduce((s, g) => s + (g.sessions || 0), 0);
  const durations = sessions.map(s => s.e - s.s);
  const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const days30 = secondsPerDay(sessions, 30);
  const week = days30.slice(-7).reduce((s, d) => s + d.sec, 0);
  const month = days30.reduce((s, d) => s + d.sec, 0);
  const top = games.filter(g => g.playtime > 0).sort((a, b) => b.playtime - a.playtime).slice(0, 10)
    .map(g => ({ id: g.id, label: g.name, value: g.playtime, cover: g.cover }));
  const plat = {};
  games.forEach(g => { if (g.playtime > 0) plat[platformLabel(g)] = (plat[platformLabel(g)] || 0) + g.playtime; });
  const platItems = Object.entries(plat).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
  const kinds = [[t("Recompilados"), games.filter(g => g.kind === "recompiled")], [t("Jogos de PC"), games.filter(g => g.kind === "normal")]]
    .map(([label, gs]) => ({ label, value: gs.reduce((s, g) => s + (g.playtime || 0), 0) })).filter(x => x.value > 0);

  const key = JSON.stringify([total, sessions.length, Math.floor(Date.now() / 60000), LANG, games.length]);
  if (el._key === key) return;
  el._key = key;

  const kpi = (label, value, sub = "") => `<div class="kpi"><small>${label}</small><b>${value}</b>${sub ? `<span>${sub}</span>` : ""}</div>`;
  const hasHistory = sessions.length > 0;
  el.innerHTML = `
    <div class="kpis">
      ${kpi(t("Tempo total"), fmtHours(total), t("{n} jogos jogados", { n: played }))}
      ${kpi(t("Últimos 7 dias"), fmtHours(week), hasHistory ? t("{t} nos últimos 30 dias", { t: fmtHours(month) }) : "")}
      ${kpi(t("Sessões"), String(sessCount), avg ? t("média de {t}", { t: fmtPlaytime(avg) }) : "")}
      ${kpi(t("Jogos na biblioteca"), String(games.length), t("{a} recompilados · {b} de PC", { a: games.filter(g => g.kind === "recompiled").length, b: games.filter(g => g.kind === "normal").length }))}
    </div>
    <section class="panel">
      <header><h3>${t("Tempo jogado por dia")}</h3><span>${t("últimos 30 dias")}</span></header>
      ${hasHistory ? barChartHTML(days30) : `<p class="hint">${t("O gráfico aparece depois das primeiras sessões. A partir desta versão, cada vez que você joga fica registrada.")}</p>`}
    </section>
    <div class="panels-2">
      <section class="panel">
        <header><h3>${t("Mais jogados")}</h3><span>${t("tempo total")}</span></header>
        ${top.length ? hbarsHTML(top, true) : `<p class="hint">${t("Nenhum jogo com tempo de jogo ainda.")}</p>`}
      </section>
      <div class="panel-stack">
        <section class="panel">
          <header><h3>${t("Por plataforma")}</h3></header>
          ${platItems.length ? hbarsHTML(platItems, false) : `<p class="hint">—</p>`}
        </section>
        <section class="panel">
          <header><h3>${t("Por categoria")}</h3></header>
          ${kinds.length ? hbarsHTML(kinds, false) : `<p class="hint">—</p>`}
        </section>
      </div>
    </div>
    <section class="panel">
      <header><h3>${t("Sessões recentes")}</h3></header>
      ${hasHistory ? `<div class="sess-table">${sessions.slice(0, 20).map(s => `
        <div class="sess-row ${s.live ? "live" : ""}" data-open="${s.g.id}">
          <div class="thumb">${s.g.cover ? `<img src="${s.g.cover}" alt="" loading="lazy" onerror="this.remove()">` : ""}</div>
          <span class="sr-name">${esc(s.g.name)}</span>
          <span>${s.live ? t("Agora") : fmtDate(s.s)}</span>
          <span>${fmtTime(s.s)} – ${s.live ? "…" : fmtTime(s.e)}</span>
          <b>${fmtPlaytime(s.e - s.s)}</b>
        </div>`).join("")}</div>` : `<p class="hint">${t("Nenhuma sessão registrada ainda.")}</p>`}
    </section>`;
}

/* ---------------- Ações ---------------- */
async function playGame(id) {
  const g = gameById(id);
  if (!g) return;
  if (isRunning(id)) { if (!state.tv) openDetails(id); return; }
  const res = await api("launch", id, false);
  if (res && res.ok) toast(t("Iniciando {name}…", { name: g.name }), "ok");
  else toast(res?.error || t("Não foi possível iniciar o jogo."), "error");
}

async function stopGame(id) {
  const g = gameById(id);
  if (!g || !confirm(t("Fechar {name}? O progresso que não foi salvo será perdido.", { name: g.name }))) return;
  await api("stop_game", id);
  toast(t("Fechando o jogo…"));
}

async function toggleFav(id) {
  const g = gameById(id);
  if (!g) return;
  g.favorite = !g.favorite;
  await api("update_game", id, { favorite: g.favorite });
  render();
}

/* ---------------- Modais ---------------- */
function openModal(title, body, foot = "", wide = false, key = null) {
  const card = $(".modal-card");
  key = key || title;
  const reopen = !$("#modal").hidden && card.dataset.key === key;
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = body;
  $("#modal-foot").innerHTML = foot;
  card.classList.toggle("wide", wide);
  if (!reopen) {
    // cada janela lembra o tamanho que o usuário deixou
    card.dataset.key = key;
    const saved = (() => { try { return JSON.parse(localGet("modal:" + key, "null")); } catch { return null; } })();
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
    localSet("modal:" + card.dataset.key, "null");
  });
}
function closeModal() { $("#modal").hidden = true; $("#modal-body").innerHTML = ""; $("#modal-body").onclick = null; $("#modal-body").onchange = null; }

function kindOpts() {
  return [
    ["auto", t("Automático"), t("Separa sozinho os ports recompilados dos jogos de PC")],
    ["recompiled", t("Recompilados"), t("Todos os jogos da pasta vão para Recompilados")],
    ["normal", t("Jogos de PC"), t("Todos os jogos da pasta vão para Jogos de PC")],
  ];
}

async function addFolderFlow() {
  const path = await api("pick_folder");
  if (!path) return;
  const def = state.nav === "all" ? "auto" : state.nav;
  openModal(t("Adicionar pasta de jogos"),
    `<div class="group-title">${t("Pasta")}</div><div class="path">${esc(path)}</div>
     <div class="group-title">${t("Categoria dos jogos")}</div>
     <div class="radio-list">${kindOpts().map(([v, label, d]) => `<label class="radio"><input type="radio" name="kind" value="${v}" ${v === def ? "checked" : ""}><span>${label}<small>${d}</small></span></label>`).join("")}</div>
     <p class="hint" style="margin:14px 0 0">${t("Pode ser uma pasta com vários jogos (cada subpasta vira um jogo) ou a pasta de um jogo só. Nenhum arquivo da pasta é alterado.")}</p>`,
    `<button class="btn" data-close>${t("Cancelar")}</button><button class="btn primary" id="confirm-folder">${t("Adicionar")}</button>`, false, "add-folder");
  $("#confirm-folder").onclick = async () => {
    const mode = $('input[name="kind"]:checked').value;
    const r = await api("add_folder", path, mode);
    closeModal();
    if (r.ok) toast(t("Pasta adicionada. Procurando jogos…"), "ok"); else toast(r.error, "error");
  };
}

async function addExeFlow() {
  const kind = state.nav === "all" ? "auto" : state.nav;
  const id = await api("add_game_exe", kind);
  if (id) { toast(t("Jogo adicionado."), "ok"); await reload(); openDetails(id); }
}

function themeOptions() {
  return [
    ["sober", t("Sóbrio"), t("Cinzas neutros, visual de launcher de desktop")],
    ["neon", "Neon", t("Roxo e ciano com destaque “Continue jogando”")],
    ["cyberpunk", "Cyberpunk", t("Amarelo neon, cantos cortados, scanlines e falhas de glitch")],
    ["midnight", "Black Midnight", t("Preto absoluto, céu estrelado, painéis de vidro e reflexo de luar nas capas")],
    ["ps5", "PS5", t("Inspirado no console: abas no topo, azul profundo, vidro fosco e Modo TV igual à tela inicial")],
    ["xbox", "Xbox", t("Inspirado na tela inicial do console: arte do jogo no fundo, blocos com borda verde e Modo TV igual ao painel")],
  ];
}

function settingsModal() {
  const s = state.lib.settings;
  const folders = state.lib.folders;
  const chk = (key, title, desc = "") => `<label class="check"><input type="checkbox" data-set="${key}" ${s[key] ? "checked" : ""}><span>${title}${desc ? `<small>${desc}</small>` : ""}</span></label>`;
  openModal(t("Configurações"), `
    <div class="group-title">${t("Perfil")}</div>
    <label class="field" style="max-width:360px"><span>${t("Seu nome")}</span>
      <input class="input" id="profile-name" maxlength="24" value="${esc(s.profile_name || "")}" placeholder="LZ Launcher" autocomplete="off">
      <small>${t("Aparece no lugar de “LZ Launcher” na barra lateral e no Modo TV. Deixe em branco para usar o nome do app.")}</small></label>

    <div class="sep"></div>
    <div class="group-title">${t("Idioma")}</div>
    <select class="select input" id="set-lang" style="max-width:280px">
      <option value="auto" ${(s.language || "auto") === "auto" ? "selected" : ""}>${t("Automático (idioma do Windows)")}</option>
      <option value="pt" ${s.language === "pt" ? "selected" : ""}>Português (Brasil)</option>
      <option value="en" ${s.language === "en" ? "selected" : ""}>English</option>
      <option value="es" ${s.language === "es" ? "selected" : ""}>Español</option>
    </select>

    <div class="sep"></div>
    <div class="group-title">${t("Aparência")}</div>
    <div class="theme-pick">${themeOptions().map(([v, label, d]) => `
      <label class="theme-opt"><input type="radio" name="theme" value="${v}" ${theme() === v ? "checked" : ""}>
        <span class="tprev tprev-${v}"><i class="tp-side"></i><i class="tp-a"></i><i class="tp-b"></i><i class="tp-c"></i></span>
        <span><b>${label}</b><small>${d}</small></span></label>`).join("")}
    </div>

    <div class="sep"></div>
    <div class="group-title">${t("Pastas de jogos")}</div>
    <div class="folder-list">${folders.length ? folders.map(f => `
      <div class="folder-item"><span class="fp" title="${esc(f.path)}">${esc(f.path)}</span>
        <select class="select" data-fmode="${esc(f.path)}">${kindOpts().map(([v, label]) => `<option value="${v}" ${f.mode === v ? "selected" : ""}>${label}</option>`).join("")}</select>
        <button class="btn" data-frm="${esc(f.path)}">${t("Remover")}</button></div>`).join("")
      : `<div class="folder-empty">${t("Nenhuma pasta adicionada.")}</div>`}</div>
    <button class="btn" data-act="add-folder">${t("Adicionar pasta…")}</button>

    <div class="sep"></div>
    <div class="group-title">${t("Lojas")}</div>
    <p class="hint">${t("Jogos instalados por estas lojas aparecem sozinhos em Jogos de PC.")}</p>
    <div class="check-grid">
      ${chk("import_steam", "Steam", t("Inclui o tempo de jogo registrado na Steam"))}
      ${chk("import_epic", "Epic Games")}
      ${chk("import_gog", "GOG Galaxy")}
      ${chk("import_ubisoft", "Ubisoft Connect")}
      ${chk("import_ea", "EA app")}
      ${chk("import_battlenet", "Battle.net")}
      ${chk("import_xbox", "Xbox / Game Pass", t("Jogos instalados nas pastas XboxGames"))}
    </div>

    <div class="sep"></div>
    <div class="group-title">${t("Inicialização")}</div>
    ${chk("start_with_windows", t("Iniciar com o Windows"), t("Abre o LZ Launcher ao ligar o PC, escondido na bandeja (ou direto no Modo TV, se a opção abaixo estiver ligada)"))}
    ${chk("tv_on_start", t("Abrir no Modo TV"), t("O app já abre em tela cheia, pronto para usar com controle"))}

    <div class="sep"></div>
    <div class="group-title">${t("Controle e Modo TV")}</div>
    ${chk("tv_return", t("Voltar ao Modo TV ao fechar o jogo"), t("Quando você sai de um jogo aberto pelo Modo TV, o LZ Launcher volta para a frente"))}
    ${chk("tv_trailers", t("Trailers no fundo"), t("Depois de alguns segundos num jogo da Steam, o trailer dele toca sem som no fundo"))}
    ${chk("tv_sounds", t("Sons de navegação"))}
    ${chk("tv_fx", t("Fundo animado"), t("Partículas e efeitos leves nas cores do tema"))}
    <p class="hint">${t("Controle: direcional ou analógico para navegar, A para jogar, B para voltar, X para favoritar, Y para buscar, ☰ para as opções e ⧉ (View) para o menu rápido (volume, desligar o PC…). Segure View + ☰ (ou o botão Xbox) por 2 segundos para fechar o jogo aberto e voltar ao Modo TV.")}</p>

    <div class="sep"></div>
    <div class="group-title">${t("Conquistas")}</div>
    ${chk("ach_overlay", t("Aviso por cima do jogo"), t("Quando você desbloqueia um troféu ou conquista, aparece um aviso no canto da tela, sem tirar o foco do jogo. Em tela cheia exclusiva o jogo pode cobrir o aviso: use o modo janela sem bordas."))}
    ${chk("ach_sound", t("Som no aviso"))}
    <label class="field" style="margin-top:8px"><span>${t("Chave da Web API da Steam (opcional)")}</span>
      <input class="input" id="steamkey" type="password" value="${esc(s.steam_api_key || "")}" placeholder="${t("Cole a chave aqui")}">
      <small>${t("Só é preciso para jogos de PC que não estão na sua conta Steam e não trazem a lista de conquistas na pasta. Gere grátis em steamcommunity.com/dev/apikey.")}</small></label>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn" id="ach-test">${t("Testar aviso")}</button>
      <button class="btn" id="ach-refresh">${t("Atualizar conquistas")}</button>
    </div>

    <div class="sep"></div>
    <div class="group-title">${t("Atualizações")}</div>
    <p class="hint" style="margin-bottom:8px">${t("Versão instalada")}: <b style="color:var(--text)">${esc(state.update?.current || "")}</b>${state.update?.mode === "portable" ? " (portable)" : ""}</p>
    <div class="upd-row"><span id="upd-status" class="upd-status"></span>
      <button class="btn" id="upd-check">${t("Procurar atualizações")}</button>
      <button class="btn primary" id="upd-install" hidden>${t("Atualizar")}</button></div>
    <pre class="upd-notes" id="upd-notes" hidden></pre>
    ${chk("check_updates", t("Verificar atualizações automaticamente"), t("Ao abrir o app e a cada 6 horas, consulta as versões publicadas no GitHub"))}
    ${chk("auto_update", t("Baixar atualizações automaticamente"), t("A versão nova é baixada em segundo plano; você só confirma para reiniciar e instalar"))}

    <div class="sep"></div>
    <div class="group-title">${t("Janela")}</div>
    ${chk("close_to_tray", t("Ao fechar, minimizar para a bandeja do sistema"), t("O LZ Launcher continua rodando perto do relógio e segue contando o tempo de jogo. Para sair de vez, use “Sair” no ícone da bandeja."))}
    ${chk("minimize_on_launch", t("Minimizar ao iniciar um jogo"))}
    ${chk("track_external", t("Contar tempo de jogos abertos fora do LZ Launcher"), t("Funciona enquanto o LZ Launcher estiver aberto ou na bandeja"))}

    <div class="sep"></div>
    <div class="group-title">${t("Capas e informações")}</div>
    ${chk("online_art", t("Buscar capas e informações na internet"), t("Capas, descrição, gênero e nota do Metacritic pela Steam, Wikipédia e SteamGridDB"))}
    <label class="field" style="margin-top:8px"><span>${t("Chave da API do SteamGridDB (opcional)")}</span>
      <input class="input" id="sgdb" type="password" value="${esc(s.steamgriddb_key || "")}" placeholder="${t("Cole a chave aqui")}">
      <small>${t("Capas verticais em alta qualidade para quase qualquer jogo. Gere grátis em steamgriddb.com → Preferências → API.")}</small></label>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn" id="refresh-art">${t("Atualizar todas as capas")}</button>
      <button class="btn" id="refresh-info">${t("Atualizar informações dos jogos")}</button>
      <button class="btn" id="restore-removed">${t("Restaurar jogos removidos")}</button>
      <button class="btn" id="open-data">${t("Abrir pasta de dados")}</button>
    </div>`,
    `<button class="btn primary" data-close>${t("Fechar")}</button>`, false, "settings");
  const body = $("#modal-body");
  body.onchange = async e => {
    const el = e.target;
    if (el.dataset.set) {
      s[el.dataset.set] = el.checked;
      const ok = await api("save_settings", { [el.dataset.set]: el.checked });
      if (ok === false && el.dataset.set === "start_with_windows") { el.checked = s.start_with_windows = false; toast(t("Não foi possível ativar o início com o Windows."), "error"); }
    }
    if (el.name === "theme") { s.theme = el.value; applyTheme(el.value); ambientId = null; render(); await api("save_settings", { theme: el.value }); }
    if (el.dataset.fmode) { await api("set_folder_mode", el.dataset.fmode, el.value); toast(t("Reclassificando os jogos…")); }
    if (el.id === "set-lang") {
      s.language = el.value;
      await api("save_settings", { language: el.value });
      await reload();
      settingsModal();
      $("#modal-body").scrollTop = 0;
    }
  };
  body.onclick = async e => {
    const rm = e.target.closest("[data-frm]");
    if (rm && confirm(t("Remover essa pasta da biblioteca? Os arquivos dos jogos não são apagados."))) {
      await api("remove_folder", rm.dataset.frm); await reload(); settingsModal();
    }
  };
  $("#profile-name").onchange = async e => {
    const v = e.target.value.trim().slice(0, 24);
    e.target.value = v;
    state.lib.settings.profile_name = v;
    renderProfileName();
    await api("save_settings", { profile_name: v });
    toast(v ? t("Nome salvo: {n}", { n: v }) : t("Voltou para “LZ Launcher”."), "ok");
  };
  $("#sgdb").onchange = async e => { await api("save_settings", { steamgriddb_key: e.target.value.trim() }); toast(t("Chave salva. Clique em “Atualizar todas as capas”."), "ok"); };
  $("#refresh-art").onclick = async () => { await api("refresh_art", null); toast(t("Atualizando capas…")); };
  $("#steamkey").onchange = async e => { await api("save_settings", { steam_api_key: e.target.value.trim() }); toast(t("Chave salva. Clique em “Atualizar conquistas”."), "ok"); };
  $("#ach-test").onclick = async () => { if (!(await api("test_trophy"))) toast(t("Nenhum jogo com conquistas ainda."), "error"); };
  $("#ach-refresh").onclick = async () => { ACH.cache = {}; ACH.overview = null; await api("refresh_achievements", null); toast(t("Atualizando conquistas…")); };
  $("#refresh-info").onclick = async () => { await api("refresh_info", null); toast(t("Atualizando informações dos jogos…")); };
  $("#restore-removed").onclick = async () => { await api("restore_removed"); toast(t("Os jogos removidos voltam após a busca."), "ok"); };
  $("#open-data").onclick = () => api("open_data_folder");
  $("#upd-check").onclick = async () => { $("#upd-status").textContent = t("Procurando atualizações…"); state.updateDismissed = false; onUpdateInfo(await api("check_updates")); };
  $("#upd-install").onclick = installUpdate;
  if (state.update) onUpdateInfo(state.update);
}

async function editModal(id) {
  const g = gameById(id);
  if (!g) return;
  const exes = [...new Set([g.exe, ...(g.exes || [])].filter(Boolean))];
  openModal(t("Editar jogo"), `
    <label class="field"><span>${t("Nome")}</span><input class="input" id="e-name" value="${esc(g.name)}"></label>
    <label class="field"><span>${t("Categoria")}</span><select class="select input" id="e-kind">
      <option value="recompiled" ${g.kind === "recompiled" ? "selected" : ""}>${t("Recompilado")}</option>
      <option value="normal" ${g.kind === "normal" ? "selected" : ""}>${t("Jogo de PC")}</option></select></label>
    <label class="field"><span>${t("Executável")}</span><div class="input-row">
      <select class="select input" id="e-exe">${g.launch_uri ? `<option value="">${t("Iniciar por {store}", { store: sourceLabel(g.source) })}</option>` : ""}
      ${exes.map(x => `<option value="${esc(x)}" ${x === g.exe ? "selected" : ""}>${esc(g.root && x.startsWith(g.root) ? "…" + x.slice(g.root.length) : x)}</option>`).join("")}
      ${!exes.length && !g.launch_uri ? `<option value="">${t("(nenhum encontrado)")}</option>` : ""}</select>
      <button class="btn" id="e-browse">${t("Procurar…")}</button></div>
      <small>${t("Nos ports, “Play ….exe” abre direto no jogo; o outro .exe abre o launcher do port.")}</small></label>
    <label class="field"><span>${t("Argumentos de inicialização")}</span><input class="input" id="e-args" value="${esc(g.args)}" placeholder="${t("opcional")}"></label>
    <label class="field"><span>${t("Tempo de jogo (horas)")}</span><input class="input" id="e-time" type="number" min="0" step="0.1" value="${(g.playtime / 3600).toFixed(1)}" style="width:140px"></label>
    <label class="check"><input type="checkbox" id="e-hidden" ${g.hidden ? "checked" : ""}><span>${t("Ocultar da biblioteca")}<small>${t("Continua acessível em Coleções → Ocultos")}</small></span></label>`,
    `<button class="btn danger" id="e-remove">${t("Remover da biblioteca")}</button><span class="spacer"></span><button class="btn" data-close>${t("Cancelar")}</button><button class="btn primary" id="e-save">${t("Salvar")}</button>`, false, "edit");
  $("#e-browse").onclick = async () => {
    const p = await api("pick_exe", id);
    if (p) $("#e-exe").add(new Option(p, p, true, true));
  };
  $("#e-remove").onclick = async () => {
    if (!confirm(t("Remover “{name}” da biblioteca? Os arquivos do jogo não são apagados.", { name: g.name }))) return;
    await api("remove_game", id); closeModal(); closeDetails(); await reload(); toast(t("Removido da biblioteca."));
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
    closeModal(); await reload(); toast(t("Alterações salvas."), "ok");
  };
}

async function artModal(id) {
  const g = gameById(id);
  if (!g) return;
  let kind = "cover";
  let data = null;
  const draw = () => {
    const wide = kind === "hero";
    const local = (data?.local || []).filter(i => wide ? i.w >= i.h * 1.2 : true);
    const online = (data?.online || []).filter(i => i.kind === kind);
    openModal(t("Capa e imagem de fundo"), `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:8px;flex-wrap:wrap">
        <div class="seg" id="a-kind"><button data-k="cover" class="${kind === "cover" ? "on" : ""}">${t("Capa")}</button><button data-k="hero" class="${kind === "hero" ? "on" : ""}">${t("Imagem de fundo")}</button></div>
        <div style="display:flex;gap:6px"><button class="btn" id="a-file">${t("Escolher arquivo…")}</button><button class="btn" id="a-reset">${t("Usar automática")}</button></div>
      </div>
      <div class="group-title">${t("Imagens no computador")}</div>
      ${data ? (local.length ? `<div class="art-grid ${wide ? "wide" : ""}">${local.map(i => `<button class="art-opt" data-src="${i.token}" title="${esc(i.path)}"><img src="/local/${i.token}" loading="lazy"><span>${esc(i.name)} · ${i.w}×${i.h}</span></button>`).join("")}</div>` : `<p class="hint">${t("Nenhuma imagem encontrada.")}</p>`) : `<div class="loading"><span class="spinner"></span>${t("Procurando…")}</div>`}
      <div class="group-title">${t("Internet")}</div>
      ${data ? (online.length ? `<div class="art-grid ${wide ? "wide" : ""}">${online.map(i => `<button class="art-opt" data-src="${esc(i.url)}"><img src="${esc(i.url)}" loading="lazy" onerror="this.parentElement.classList.add('bad')"><span>${esc(i.label)}</span></button>`).join("")}</div>` : `<p class="hint">${t("Nada encontrado. Configure a chave do SteamGridDB para mais opções.")}</p>`) : `<div class="loading"><span class="spinner"></span>${t("Buscando na Steam, Wikipédia e SteamGridDB…")}</div>`}`,
      "", true, "art");
    $("#a-kind").onclick = e => { const b = e.target.closest("[data-k]"); if (b) { kind = b.dataset.k; draw(); } };
    $("#a-file").onclick = async () => { if (await api("pick_art_file", id, kind)) { await reload(); closeModal(); toast(t("Imagem atualizada."), "ok"); } };
    $("#a-reset").onclick = async () => { await api("set_art", id, kind, null); await reload(); closeModal(); toast(t("Imagem automática restaurada.")); };
    $("#modal-body").onclick = async e => {
      const b = e.target.closest(".art-opt");
      if (!b) return;
      b.style.opacity = ".5";
      const ok = await api("set_art", id, kind, b.dataset.src);
      if (ok) { await reload(); closeModal(); toast(t("Imagem atualizada."), "ok"); } else { b.style.opacity = "1"; toast(t("Não foi possível baixar essa imagem."), "error"); }
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
    idle: t("Verificação automática ligada."),
    checking: t("Procurando atualizações…"),
    uptodate: t("Você está na versão mais recente ({v}).", { v: u.current }),
    available: t("Nova versão {v} disponível.", { v }),
    downloading: t("Baixando a versão {v}… {p}%", { v, p: Math.round((u.progress || 0) * 100) }),
    ready: t("Versão {v} baixada e pronta para instalar.", { v }),
    installing: t("Instalando… o LZ Launcher vai reiniciar."),
    error: u.error || t("Erro ao verificar atualizações."),
  }[u.status] || "";
}

function onUpdateInfo(u) {
  state.update = u;
  $("#app-version").textContent = t("Versão") + " " + u.current;
  const card = $("#update-card");
  const has = ["available", "downloading", "ready", "installing"].includes(u.status) && u.latest;
  if (!has || state.updateDismissed) { card.hidden = true; }
  else {
    card.hidden = false;
    const busy = u.status === "downloading" || u.status === "installing";
    const btn = u.status === "ready" ? t("Reiniciar e atualizar") : t("Atualizar agora");
    const html = `<div class="uc-title">${t("Atualização disponível")}</div>
      <div class="uc-text">${esc(updateLabel(u))}</div>
      ${u.status === "downloading" ? `<div class="uc-bar"><i style="width:${Math.round((u.progress || 0) * 100)}%"></i></div>` : ""}
      <div class="uc-actions">${busy ? "" : `<button class="btn primary" data-update="install">${btn}</button><button class="btn" data-update="later">${t("Depois")}</button>`}</div>`;
    if (card._html !== html) { card.innerHTML = html; card._html = html; }
    if (!state.updateToastShown) {
      state.updateToastShown = true;
      toast(t("Nova versão {v} do LZ Launcher disponível.", { v: u.latest.version }), "ok");
    }
  }
  const st = $("#upd-status");
  if (st) {
    st.textContent = updateLabel(u);
    const b = $("#upd-install");
    b.hidden = !(u.status === "available" || u.status === "ready");
    b.textContent = u.status === "ready" ? t("Reiniciar e atualizar") : t("Atualizar para {v}", { v: u.latest?.version || "" });
    const notes = $("#upd-notes");
    notes.hidden = !(has && u.latest?.notes);
    notes.textContent = u.latest?.notes || "";
  }
}

async function installUpdate() {
  if (Object.keys(state.running).length &&
    !confirm(t("Há um jogo aberto. Ele continua rodando, mas o tempo desta sessão pode deixar de ser contado enquanto o LZ Launcher reinicia. Atualizar agora?"))) return;
  if (state.update?.mode !== "source") toast(t("Atualizando… o LZ Launcher vai fechar e abrir de novo."));
  const r = await api("install_update");
  if (r && !r.ok && r.error) toast(r.error, "error");
}

/* ---------------- Controle (gamepad) ---------------- */
const PAD_BUTTONS = { 0: "a", 1: "b", 2: "x", 3: "y", 4: "lb", 5: "rb", 8: "select", 9: "start", 12: "up", 13: "down", 14: "left", 15: "right", 16: "guide" };
const pad = { prev: {}, next: {}, announced: false };

function startGamepad() {
  window.addEventListener("gamepadconnected", e => {
    if (!pad.announced) {
      pad.announced = true;
      toast(t("Controle conectado: {name}. Aperte Menu (☰) para o Modo TV.", { name: (e.gamepad.id || "").replace(/\(.*?\)/g, "").trim() || "Gamepad" }), "ok");
    }
  });
  const loop = () => {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    // só reage com a janela em foco (para não agir enquanto você joga)
    if (pads.length && document.hasFocus()) {
      const now = performance.now();
      const held = {};
      for (const p of pads) {
        for (const [i, name] of Object.entries(PAD_BUTTONS)) if (p.buttons[i]?.pressed) held[name] = true;
        const [ax, ay] = [p.axes[0] || 0, p.axes[1] || 0];
        if (ax < -0.55) held.left = true; if (ax > 0.55) held.right = true;
        if (ay < -0.55) held.up = true; if (ay > 0.55) held.down = true;
      }
      for (const name of new Set([...Object.values(PAD_BUTTONS)])) {
        if (held[name] && !pad.prev[name]) { padAction(name); pad.next[name] = now + 380; }
        else if (held[name] && ["up", "down", "left", "right"].includes(name) && now >= pad.next[name]) { padAction(name); pad.next[name] = now + 110; }
      }
      pad.prev = held;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function padAction(act) {
  if (state.tv) { tvAction(act); return; }
  if (act === "start" || act === "select" || act === "guide") { enterTV(); return; }
  if (act === "b") {
    if (!$("#modal").hidden) closeModal();
    else if (state.current) closeDetails();
    else if (state.page !== "library") showPage("library");
    return;
  }
  if (act === "lb" || act === "rb") {
    const order = [["library", "all"], ["library", "recompiled"], ["library", "normal"], ["stats", null]];
    let i = order.findIndex(([p, n]) => p === state.page && (n === null || (n === state.nav && !state.col)));
    i = (i + (act === "rb" ? 1 : order.length - 1) + (i < 0 ? 1 : 0)) % order.length;
    const [p, n] = order[i];
    if (n) { state.nav = n; state.col = null; localSet("nav", n); }
    showPage(p);
    return;
  }
  const cur = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  if (act === "a") { if (cur) { cur.classList.contains("card") || cur.classList.contains("row") ? openDetails(cur.dataset.id) : cur.click(); } return; }
  if (act === "x") {
    const id = cur?.dataset?.id || state.current;
    if (id) toggleFav(id);
    return;
  }
  if (act === "y") { if (cur?.dataset?.id) playGame(cur.dataset.id); else if (state.current) playGame(state.current); return; }
  if (["up", "down", "left", "right"].includes(act)) spatialMove(act, cur);
}

// Navegação espacial: vai para o elemento visível mais próximo na direção pedida
function focusables() {
  const scope = !$("#modal").hidden ? $("#modal") : document;
  return $$(".nav-item, .side-btn, .card, .row, .actionbar button:not([hidden]), .back, .lib-tools button, .hbar, .sess-row, .modal-card button, .modal-card input, .modal-card select, .info-src a, .meta-score", scope)
    .filter(el => el.offsetParent !== null && !el.closest("[hidden]"));
}
function spatialMove(dir, cur) {
  const items = focusables();
  if (!items.length) return;
  if (!cur || !items.includes(cur)) {
    (items.find(el => el.classList.contains("card") || el.classList.contains("row")) || items[0]).focus();
    padFocus();
    return;
  }
  const r = cur.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let best = null, bestScore = Infinity;
  for (const el of items) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect();
    const x = b.left + b.width / 2, y = b.top + b.height / 2;
    const dx = x - cx, dy = y - cy;
    const ok = { left: dx < -4, right: dx > 4, up: dy < -4, down: dy > 4 }[dir];
    if (!ok) continue;
    const main = dir === "left" || dir === "right" ? Math.abs(dx) : Math.abs(dy);
    const cross = dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx);
    const score = main + cross * 2.5;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) { best.focus({ preventScroll: true }); best.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }); padFocus(); }
}
function padFocus() { document.body.classList.add("pad-mode"); }

/* ---------------- Sincronização ---------------- */
async function reload() {
  const lib = await api("library");
  state.lib = lib;
  state.revision = lib.revision;
  const lang = QP.get("lang") || lib.lang || "pt";
  if (lang !== LANG) { setLang(lang); $("#grid")._html = null; $("#list")._html = null; $("#spotlight").dataset.key = ""; $("#stats-body")._key = null; tvLangChanged(); }
  applyTheme(QP.get("theme") || lib.settings.theme);
  render();
}

let lastRunningKeys = "";
async function poll() {
  try {
    const s = await api("status");
    state.running = s.running || {};
    if (s.update) onUpdateInfo(s.update);
    state.pad = s.pad || null;
    (s.events || []).forEach(ev => { tvHandleEvent(ev); trophyHandleEvent(ev); });
    if (state.tv) renderTVHeader();
    $("#scanbar").hidden = !s.scanning;
    $("#scan-msg").textContent = s.scan_message || t("Procurando jogos…");
    $("#btn-rescan").classList.toggle("spin", !!(s.scanning || s.art_busy));
    state.scanning = s.scanning;
    const keys = Object.keys(state.running).sort().join(",");
    if (s.revision !== state.revision) await reload();
    else if (keys !== lastRunningKeys) render();
    else if (keys) {
      renderNowPlaying();
      if (state.current && isRunning(state.current)) renderDetails();
      if (state.page === "stats") renderStats();
      if (state.tv) renderTV();
    }
    lastRunningKeys = keys;
  } catch (e) { /* janela fechando */ }
  setTimeout(poll, 1000);
}

/* ---------------- Eventos ---------------- */
function bindEvents() {
  $("#nav").onclick = e => {
    const b = e.target.closest(".nav-item"); if (!b) return;
    if (b.dataset.page) { showPage(b.dataset.page); return; }
    if (b.dataset.nav) { state.nav = b.dataset.nav; state.col = null; localSet("nav", state.nav); }
    else state.col = state.col === b.dataset.col ? null : b.dataset.col;
    showPage("library"); $("#scroller").scrollTop = 0;
  };
  $("#search").oninput = e => { state.query = e.target.value; render(); };
  $("#sort").onchange = e => { state.sort = e.target.value; state.sortDesc = false; localSet("sort", state.sort); render(); };
  $("#view-toggle").onclick = e => {
    const b = e.target.closest("[data-view]"); if (!b) return;
    state.view = b.dataset.view; localSet("view", state.view); render();
  };
  $("#size").oninput = e => { document.documentElement.style.setProperty("--card", e.target.value + "px"); localSet("size", e.target.value); };
  $("#btn-add").onclick = e => { e.stopPropagation(); $("#menu-add").hidden = !$("#menu-add").hidden; };
  $("#btn-rescan").onclick = async () => { await api("rescan", false); toast(t("Procurando jogos novos…")); };
  $("#btn-settings").onclick = settingsModal;
  $("#wordmark").onclick = () => { settingsModal(); const el = $("#profile-name"); if (el) { el.focus(); el.select(); } };
  $("#btn-tv").onclick = enterTV;
  $("#modal-close").onclick = closeModal;
  // fecha ao clicar fora, mas não quando o clique termina fora depois de arrastar/selecionar dentro da janela
  let downOnBackdrop = false;
  $("#modal").onpointerdown = e => { downOnBackdrop = e.target.id === "modal"; };
  $("#modal").onclick = e => { if ((e.target.id === "modal" && downOnBackdrop) || e.target.closest("[data-close]")) closeModal(); };
  $("#d-back").onclick = closeDetails;
  $("#d-play").onclick = () => isRunning(state.current) ? stopGame(state.current) : playGame(state.current);
  $("#d-alt").onclick = async () => {
    const r = await api("launch", state.current, true);
    r.ok ? toast(t("Abrindo o launcher do port…"), "ok") : toast(r.error, "error");
  };
  $("#d-fav").onclick = () => toggleFav(state.current);
  $("#d-folder").onclick = () => api("open_folder", state.current);
  $("#d-art").onclick = () => artModal(state.current);
  $("#d-edit").onclick = () => editModal(state.current);
  $("#d-trophies-refresh").onclick = async () => { delete ACH.cache[state.current]; await api("refresh_achievements", state.current); toast(t("Atualizando conquistas…")); setTimeout(() => { const g = gameById(state.current); if (g) renderDetailsTrophies(g, true); }, 4000); };
  $("#d-info-refresh").onclick = async () => { await api("refresh_info", state.current); toast(t("Atualizando informações…")); };

  // fundo dinâmico no tema Cyberpunk
  const ambient = e => {
    if (!AMBIENT_THEMES.includes(theme())) return;
    const c = e.target.closest(".card, .row");
    if (c) setAmbient(gameById(c.dataset.id));
  };
  $("#grid").addEventListener("mouseover", ambient);
  $("#list").addEventListener("mouseover", ambient);
  $("#grid").addEventListener("focusin", ambient);
  $("#list").addEventListener("focusin", ambient);

  bindTV();

  document.addEventListener("click", e => {
    if (!e.target.closest(".menu-wrap")) $("#menu-add").hidden = true;
    const url = e.target.closest("[data-url]");
    if (url) { api("open_url", url.dataset.url); return; }
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
    if (o && !e.target.closest("#tv")) { openDetails(o.dataset.open); return; }
    const item = e.target.closest(".card, .row");
    if (item) openDetails(item.dataset.id);
  });
  document.addEventListener("mousedown", () => document.body.classList.remove("pad-mode"));
  document.addEventListener("keydown", e => {
    if (state.tv) { tvKey(e); return; }
    if (e.key === "F11") { e.preventDefault(); enterTV(); return; }
    if (e.key === "Escape") {
      if (!$("#modal").hidden) closeModal();
      else if (state.current) closeDetails();
      else if (state.query) { $("#search").value = ""; state.query = ""; render(); }
    }
    if ((e.key === "f" && e.ctrlKey) || (e.key === "/" && document.activeElement.tagName !== "INPUT")) { e.preventDefault(); showPage("library"); $("#search").focus(); }
    if (e.key === "Enter" && (document.activeElement.classList.contains("card") || document.activeElement.classList.contains("row"))) openDetails(document.activeElement.dataset.id);
  });
  document.addEventListener("contextmenu", e => { if (!e.target.closest("input")) e.preventDefault(); });
}

async function boot() {
  try { UI = (await api("ui_prefs")) || {}; } catch { UI = {}; }
  state.nav = localGet("nav", "all");
  state.sort = localGet("sort", "name");
  state.view = localGet("view", "grid");
  $("#sort").value = state.sort;
  const size = localGet("size", "170");
  $("#size").value = size;
  document.documentElement.style.setProperty("--card", size + "px");
  if (QP.get("view")) state.view = QP.get("view");
  if (QP.get("nav")) state.nav = QP.get("nav");
  bindEvents();
  bindModalResize();
  bindTooltips();
  bindTrophies();
  startGamepad();
  await reload();
  if (QP.get("page")) showPage(QP.get("page"));
  if (QP.get("game")) {
    const g = state.lib.games.find(x => x.name.toLowerCase().includes(QP.get("game").toLowerCase()));
    if (g) openDetails(g.id);
    if (g && QP.get("sec") === "trophies") setTimeout(() => { const s = $("#d-trophies-sec"); s.scrollIntoView(); let p = s.parentElement; while (p && p.scrollHeight <= p.clientHeight + 5) p = p.parentElement; if (p) p.scrollTop -= 90; }, 2500);
  }
  if (QP.get("tv") || (state.lib.settings.tv_on_start && !QP.get("page") && !QP.get("game"))) enterTV();
  if (state.tv && QP.get("pscard") && typeof PS !== "undefined") { PS.zone = "cards"; PS.card = +QP.get("pscard"); renderTV(); }
  if (state.tv && QP.get("tvov")) { if (QP.get("q")) TV.query = QP.get("q"); openOverlay(QP.get("tvov")); }
  if (QP.get("settings")) settingsModal();
  poll();
}

if (window.pywebview) boot();
else {
  let started = false;
  const go = () => { if (!started) { started = true; boot(); } };
  window.addEventListener("pywebviewready", go);
  setTimeout(() => { if (!window.pywebview) go(); }, 600);
}
