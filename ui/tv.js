/* LZ Launcher - Modo TV (tela cheia para usar com controle) */
"use strict";

const TV = {
  row: 0, cols: {}, expanded: false, query: "",
  overlay: null,            // null | "keyboard" | "options" | "quick"
  kb: 0, menu: 0, confirm: null,
  trailerTimer: null, trailerFor: null, focusId: null,
  fx: null,
};

/* ---------------- Preferências do Modo TV ---------------- */
const TV_SORTS = ["recent", "name", "playtime", "platform"];
const TV_SIZES = { small: 138, medium: 168, large: 210 };
function tvPref(k, d) { return localGet("tv_" + k, d); }
function tvSort() { return tvPref("sort", "recent"); }
function tvSetting(k) { return state.lib.settings[k] !== false; }

/* ---------------- Fileiras ---------------- */
function tvRows() {
  const games = state.lib.games.filter(g => !g.hidden);
  const sort = tvSort();
  const by = list => sortGames([...list], sort);
  const q = TV.query.trim().toLowerCase();
  if (q) {
    const found = sortGames(games.filter(g => g.name.toLowerCase().includes(q) || (g.platform || "").toLowerCase().includes(q)
      || (g.info?.genres || []).some(x => x.toLowerCase().includes(q))), "name");
    return [{ id: "search", title: t("Resultados para “{q}”", { q: TV.query }), games: found }];
  }
  const rows = [
    { id: "running", title: t("Jogando agora"), games: games.filter(g => isRunning(g.id)) },
    { id: "continue", title: t("Continue jogando"), games: sortGames(games.filter(g => g.last_played), "recent").slice(0, 20) },
    { id: "favorites", title: t("Favoritos"), games: by(games.filter(g => g.favorite)) },
    { id: "recompiled", title: t("Recompilados"), games: by(games.filter(g => g.kind === "recompiled")) },
    { id: "normal", title: t("Jogos de PC"), games: by(games.filter(g => g.kind === "normal")) },
    { id: "most", title: t("Mais jogados"), games: sortGames(games.filter(g => g.playtime > 0), "playtime").slice(0, 20) },
    { id: "all", title: t("Todos os jogos"), games: by(games) },
  ];
  return rows.filter(r => r.games.length);
}
function tvFocused() {
  const rows = tvRows();
  const row = rows[Math.min(TV.row, rows.length - 1)];
  if (!row) return { rows, row: null, game: null, col: 0 };
  const col = Math.max(0, Math.min(TV.cols[row.id] || 0, row.games.length - 1));
  return { rows, row, game: row.games[col], col };
}

/* ---------------- Entrar / sair ---------------- */
function enterTV() {
  if (state.tv) return;
  state.tv = true;
  closeModal();
  $("#tv").hidden = false;
  document.body.classList.add("tv-on");
  api("set_tv", true).catch(() => { });
  TV.row = 0; TV.expanded = false; TV.overlay = null;
  $("#tv-rows")._html = null;
  applyTVPrefs();
  renderTV();
  tickClock();
  fxStart();
  sfx("open");
}
function exitTV() {
  if (!state.tv) return;
  state.tv = false;
  stopTrailer();
  fxStop();
  $("#tv").hidden = true;
  document.body.classList.remove("tv-on");
  api("set_tv", false).catch(() => { });
}
function tickClock() {
  if (!state.tv) return;
  $("#tv-clock").textContent = new Date().toLocaleTimeString(LOCALE(), { hour: "2-digit", minute: "2-digit" });
  setTimeout(tickClock, 15000);
}
function applyTVPrefs() {
  const tv = $("#tv");
  tv.style.setProperty("--tv-card", (TV_SIZES[tvPref("size", "medium")] || 168) + "px");
  tv.style.setProperty("--tv-scale", tvPref("text", "normal") === "large" ? "1.2" : "1");
}
function tvLangChanged() { $("#tv-rows")._html = null; }

/* ---------------- Render ---------------- */
function renderTV() {
  if (!state.tv) return;
  const { rows, row, game: g } = tvFocused();
  TV.row = Math.max(0, Math.min(TV.row, rows.length - 1));

  // fileiras (o HTML só é refeito quando muda algo além do foco)
  const wrap = $("#tv-rows");
  const html = rows.map((r, ri) => `
    <section class="tv-row" data-row="${ri}">
      <h2>${esc(r.title)} <span>${r.games.length}</span></h2>
      <div class="tv-shelf">${r.games.map((x, ci) => `<div class="tv-card" data-ri="${ri}" data-ci="${ci}" data-name="${esc(x.name)}">${coverHTML(x)}${isRunning(x.id) ? `<span class="tv-live">${t("Jogando")}</span>` : ""}${x.favorite ? '<span class="tv-fav">★</span>' : ""}</div></div>`).join("")}</div>
    </section>`).join("") || `<div class="tv-empty">${TV.query ? t("Nenhum jogo encontrado para “{q}”.", { q: esc(TV.query) }) : t("Nenhum jogo nesta aba.")}</div>`;
  if (wrap._html !== html) { wrap.innerHTML = html; wrap._html = html; }
  $$(".tv-card.focus", wrap).forEach(c => c.classList.remove("focus"));
  $$(".tv-row", wrap).forEach((el, ri) => el.classList.toggle("current", ri === TV.row));
  const cur = row && $(`.tv-card[data-ri="${TV.row}"][data-ci="${Math.max(0, Math.min(TV.cols[row.id] || 0, row.games.length - 1))}"]`, wrap);
  if (cur) {
    cur.classList.add("focus");
    const shelf = cur.parentElement;  // rola só a fileira (sem mexer na página)
    shelf.scrollTo({ left: cur.offsetLeft - shelf.clientWidth / 2 + cur.offsetWidth / 2, behavior: "smooth" });
    const rowEl = cur.closest(".tv-row");
    wrap.style.setProperty("--tv-shift", `-${rowEl.offsetTop}px`);
  }

  renderTVInfo(g);
  renderTVHeader();
  renderTVHints();
  renderOverlay();
  if (g && g.id !== TV.focusId) { TV.focusId = g.id; scheduleTrailer(g); setTVBackground(g); }
}

function setTVBackground(g) {
  const src = g.hero || g.cover || "";
  const bgs = $$(".tv-bg img");
  const cur = bgs.find(b => b.classList.contains("on"));
  if (cur && cur.dataset.src === src) return;
  const next = bgs.find(b => b !== cur) || bgs[0];
  next.dataset.src = src;
  next.classList.toggle("blurred", !g.hero);
  if (src) next.src = src; else next.removeAttribute("src");
  next.classList.add("on"); if (cur) cur.classList.remove("on");
}

// mini gráfico com o tempo jogado nos últimos 14 dias deste jogo
function tvSessionsHTML(g) {
  const hist = g.history || [];
  if (!hist.length && !isRunning(g.id)) return "";
  const sessions = hist.map(s => ({ s: s.s, e: s.e }));
  if (isRunning(g.id)) sessions.push({ s: Date.now() / 1000 - state.running[g.id], e: Date.now() / 1000 });
  const days = secondsPerDay(sessions, 14);
  const max = Math.max(...days.map(d => d.sec), 1);
  const avg = hist.length ? hist.reduce((a, s) => a + (s.e - s.s), 0) / hist.length : 0;
  return `<div class="tv-spark">
    <div class="tv-spark-bars">${days.map(d => `<i style="height:${d.sec ? Math.max(8, (d.sec / max) * 100) : 0}%"></i>`).join("")}</div>
    <small>${t("Últimas 2 semanas")} · ${t(hist.length === 1 ? "{n} sessão" : "{n} sessões", { n: hist.length })}${avg ? " · " + t("média de {t}", { t: fmtPlaytime(avg) }) : ""}</small>
  </div>`;
}

function renderTVInfo(g) {
  const info = $("#tv-info");
  info.classList.toggle("expanded", TV.expanded);
  if (!g) { info.innerHTML = ""; return; }
  const running = isRunning(g.id);
  const i = g.info || {};
  const chips = [
    `<span class="tv-chip">${esc(platformLabel(g))}</span>`,
    g.kind === "recompiled" ? `<span class="tv-chip">${t("Recompilado")}</span>` : "",
    i.year ? `<span class="tv-chip">${i.year}</span>` : "",
    i.metacritic ? `<span class="tv-chip meta">Metacritic ${i.metacritic}</span>` : "",
    ...(i.genres || []).slice(0, 2).map(x => `<span class="tv-chip">${esc(x)}</span>`),
  ].join("");
  const key = [g.id, running, Math.floor((state.running[g.id] || 0) / 5), g.playtime, g.favorite, TV.expanded, LANG, (g.history || []).length, !!g.info].join("|");
  if (info._key === key) return;
  info._key = key;
  info.innerHTML = `
    <h1>${esc(g.name)}</h1>
    <div class="tv-chips">${chips}</div>
    <div class="tv-stats">
      <div><small>${t("Tempo de jogo")}</small><b>${fmtPlaytime(g.playtime)}</b></div>
      <div><small>${running ? t("Sessão atual") : t("Última vez")}</small><b>${running ? fmtClock(state.running[g.id]) : fmtAgo(g.last_played)}</b></div>
      ${tvSessionsHTML(g)}
    </div>
    ${i.description ? `<p class="tv-desc">${esc(i.description)}</p>` : ""}
    ${TV.expanded && i.developers?.length ? `<p class="tv-more">${t("Desenvolvedora")}: ${esc(i.developers.join(", "))}${i.publishers?.length ? " · " + t("Publicadora") + ": " + esc(i.publishers.join(", ")) : ""}</p>` : ""}
    <div class="tv-actions"><span class="tv-btn primary"><i class="gp a">A</i>${running ? t("Jogando agora") : t("Jogar")}</span></div>`;
}

function batteryHTML() {
  const p = state.pad;
  if (!p || !p.connected) return "";
  const b = p.battery;
  if (!b || b.wired || !b.level) return `<span class="tv-pad" title="${t("Controle conectado")}">${PAD_ICON}</span>`;
  const bars = { empty: 0, low: 1, medium: 2, full: 3 }[b.level] ?? 0;
  return `<span class="tv-pad ${b.level}" title="${t("Bateria do controle")}: ${{ empty: t("vazia"), low: t("fraca"), medium: t("média"), full: t("cheia") }[b.level]}">${PAD_ICON}<span class="tv-bat">${[0, 1, 2].map(n => `<i class="${n < bars ? "on" : ""}"></i>`).join("")}</span></span>`;
}
const PAD_ICON = '<svg viewBox="0 0 24 24"><path d="M6 9h4M8 7v4M15 10h.01M18 8h.01M6.5 5h11a4.5 4.5 0 0 1 4.4 5.4l-1 5A3 3 0 0 1 16 17l-2-2h-4l-2 2a3 3 0 0 1-4.9-1.6l-1-5A4.5 4.5 0 0 1 6.5 5Z"/></svg>';

function renderTVHeader() {
  $("#tv-search-chip").innerHTML = TV.query ? `<span class="tv-chip search">🔍 ${esc(TV.query)} <i class="gp b">B</i></span>` : "";
  const html = batteryHTML();
  const el = $("#tv-battery");
  if (el._html !== html) { el.innerHTML = html; el._html = html; }
}

function renderTVHints() {
  const { game: g } = tvFocused();
  const hints = TV.overlay ? [] : [
    ["a", "A", t("Jogar")], ["x", "X", g?.favorite ? t("Remover favorito") : t("Favoritar")], ["y", "Y", t("Buscar")],
    ["gp-start", "☰", t("Opções")], ["gp-view", "⧉", t("Menu rápido")], ["b", "B", TV.query ? t("Limpar busca") : t("Sair do Modo TV")],
  ];
  const html = hints.map(([c, k, label]) => `<span><i class="gp ${c}">${k}</i>${label}</span>`).join("");
  const el = $("#tv-hints");
  if (el._html !== html) { el.innerHTML = html; el._html = html; }
}

/* ---------------- Sobreposições: teclado, opções, menu rápido ---------------- */
const KB_KEYS = [..."ABCDEFGHIJ", ..."KLMNOPQRST", ..."UVWXYZ0123", ..."456789-:'.", "space", "back", "clear", "ok"];
const KB_COLS = 10;

function optionItems() {
  const s = state.lib.settings;
  const onOff = v => v ? t("Ligado") : t("Desligado");
  const sortLabels = { recent: t("Jogados recentemente"), name: t("Nome"), playtime: t("Tempo de jogo"), platform: t("Plataforma") };
  const sizeLabels = { small: t("Pequenas"), medium: t("Médias"), large: t("Grandes") };
  return [
    { id: "sort", label: t("Ordenar por"), value: sortLabels[tvSort()] },
    { id: "size", label: t("Tamanho das capas"), value: sizeLabels[tvPref("size", "medium")] },
    { id: "text", label: t("Tamanho do texto"), value: tvPref("text", "normal") === "large" ? t("Grande") : t("Normal") },
    { id: "tv_trailers", label: t("Trailers no fundo"), value: onOff(s.tv_trailers !== false) },
    { id: "tv_sounds", label: t("Sons de navegação"), value: onOff(s.tv_sounds !== false) },
    { id: "tv_fx", label: t("Fundo animado"), value: onOff(s.tv_fx !== false) },
    { id: "tv_return", label: t("Voltar ao Modo TV ao fechar o jogo"), value: onOff(s.tv_return !== false) },
    { id: "exit", label: t("Sair do Modo TV"), action: true },
  ];
}

function quickItems() {
  const running = Object.keys(state.running);
  const items = [
    { id: "vol_down", label: t("Diminuir volume"), icon: "🔉" },
    { id: "vol_up", label: t("Aumentar volume"), icon: "🔊" },
    { id: "mute", label: t("Mudo"), icon: "🔇" },
  ];
  if (running.length) items.push({ id: "close_game", label: t("Fechar {name}", { name: gameById(running[0])?.name || "" }), icon: "✕", confirm: true });
  items.push(
    { id: "exit", label: t("Sair do Modo TV"), icon: "⇱" },
    { id: "quit", label: t("Fechar o LZ Launcher"), icon: "⏻", confirm: true },
    { id: "sleep", label: t("Suspender o PC"), icon: "☾", confirm: true },
    { id: "restart", label: t("Reiniciar o PC"), icon: "↻", confirm: true },
    { id: "shutdown", label: t("Desligar o PC"), icon: "⏻", confirm: true },
  );
  return items;
}

function renderOverlay() {
  const el = $("#tv-overlay");
  el.hidden = !TV.overlay;
  if (!TV.overlay) { el._html = null; return; }
  let html = "";
  if (TV.overlay === "keyboard") {
    const label = k => ({ space: t("Espaço"), back: "⌫", clear: t("Limpar"), ok: "OK" }[k] || k);
    html = `<div class="tv-panel kb">
      <div class="kb-field">${esc(TV.query) || `<span>${t("Digite o nome do jogo")}</span>`}<i class="caret"></i></div>
      <div class="kb-grid">${KB_KEYS.map((k, i) => `<button class="kb-key ${k.length > 1 ? "wide k-" + k : ""} ${i === TV.kb ? "focus" : ""}" data-kb="${i}">${label(k)}</button>`).join("")}</div>
      <div class="kb-hints"><span><i class="gp a">A</i>${t("Digitar")}</span><span><i class="gp x">X</i>${t("Apagar")}</span><span><i class="gp y">Y</i>${t("Espaço")}</span><span><i class="gp gp-start">☰</i>OK</span><span><i class="gp b">B</i>${t("Fechar")}</span></div>
    </div>`;
  } else if (TV.overlay === "options") {
    html = `<div class="tv-panel tvmenu"><h2>${t("Opções do Modo TV")}</h2>${optionItems().map((o, i) => `
      <div class="tv-mi ${i === TV.menu ? "focus" : ""}" data-menu="${i}">
        <span>${o.label}</span>${o.action ? "" : `<b><i>‹</i>${esc(o.value)}<i>›</i></b>`}</div>`).join("")}
      <div class="kb-hints"><span><i class="gp a">A</i>${t("Alterar")}</span><span><i class="gp b">B</i>${t("Fechar")}</span></div></div>`;
  } else if (TV.overlay === "quick") {
    const items = quickItems();
    html = `<div class="tv-panel tvmenu tvquick"><h2>${t("Menu rápido")} <span class="tv-clock-sm">${new Date().toLocaleTimeString(LOCALE(), { hour: "2-digit", minute: "2-digit" })}</span></h2>
      ${items.map((o, i) => `<div class="tv-mi ${i === TV.menu ? "focus" : ""} ${TV.confirm === o.id ? "confirm" : ""}" data-menu="${i}">
        <span><em>${o.icon}</em>${TV.confirm === o.id ? t("Aperte A de novo para confirmar") : o.label}</span></div>`).join("")}
      <div class="kb-hints"><span><i class="gp a">A</i>${t("Selecionar")}</span><span><i class="gp b">B</i>${t("Fechar")}</span></div></div>`;
  }
  if (el._html !== html) { el.innerHTML = html; el._html = html; }
}

function openOverlay(kind) {
  TV.overlay = kind; TV.menu = 0; TV.confirm = null;
  if (kind === "keyboard") TV.kb = 0;
  sfx("open");
  renderTV();
}
function closeOverlay() { TV.overlay = null; TV.confirm = null; sfx("back"); renderTV(); }

function kbPress(i) {
  const k = KB_KEYS[i];
  if (k === "ok") { TV.overlay = null; TV.row = 0; sfx("select"); }
  else if (k === "back") TV.query = TV.query.slice(0, -1);
  else if (k === "clear") TV.query = "";
  else if (k === "space") TV.query += " ";
  else TV.query += k.toLowerCase();
  TV.row = 0; TV.cols = {};
  if (k !== "ok") sfx("move");
  renderTV();
}

async function optionChange(o, dir = 1) {
  const cycle = (list, cur) => list[(list.indexOf(cur) + dir + list.length) % list.length];
  if (o.id === "sort") localSet("tv_sort", cycle(TV_SORTS, tvSort()));
  else if (o.id === "size") localSet("tv_size", cycle(["small", "medium", "large"], tvPref("size", "medium")));
  else if (o.id === "text") localSet("tv_text", tvPref("text", "normal") === "large" ? "normal" : "large");
  else if (o.id === "exit") { TV.overlay = null; exitTV(); return; }
  else {
    const v = !(state.lib.settings[o.id] !== false);
    state.lib.settings[o.id] = v;
    await api("save_settings", { [o.id]: v });
    if (o.id === "tv_fx") v ? fxStart() : fxStop();
    if (o.id === "tv_trailers" && !v) stopTrailer();
  }
  sfx("move");
  applyTVPrefs();
  $("#tv-rows")._html = null;
  renderTV();
}

async function quickRun(o) {
  if (o.confirm && TV.confirm !== o.id) { TV.confirm = o.id; sfx("move"); renderTV(); return; }
  TV.confirm = null;
  sfx("select");
  switch (o.id) {
    case "vol_up": api("system_volume", "up"); return;
    case "vol_down": api("system_volume", "down"); return;
    case "mute": api("system_volume", "mute"); return;
    case "close_game": for (const id of Object.keys(state.running)) await api("stop_game", id); toast(t("Fechando o jogo…")); break;
    case "exit": TV.overlay = null; exitTV(); return;
    case "quit": api("quit_app"); return;
    case "sleep": case "restart": case "shutdown": TV.overlay = null; renderTV(); api("system_power", o.id); return;
  }
  TV.overlay = null;
  renderTV();
}

/* ---------------- Ações (controle e teclado) ---------------- */
function tvAction(act) {
  sfxUnlock();
  if (TV.overlay === "keyboard") {
    const cols = KB_COLS, n = KB_KEYS.length;
    if (act === "left") TV.kb = Math.max(0, TV.kb - 1);
    else if (act === "right") TV.kb = Math.min(n - 1, TV.kb + 1);
    else if (act === "up") TV.kb = Math.max(0, TV.kb - cols);
    else if (act === "down") TV.kb = Math.min(n - 1, TV.kb + cols);
    else if (act === "a") { kbPress(TV.kb); return; }
    else if (act === "x") { kbPress(KB_KEYS.indexOf("back")); return; }
    else if (act === "y") { kbPress(KB_KEYS.indexOf("space")); return; }
    else if (act === "start") { kbPress(KB_KEYS.indexOf("ok")); return; }
    else if (act === "b") { closeOverlay(); return; }
    else return;
    sfx("move"); renderTV(); return;
  }
  if (TV.overlay === "options" || TV.overlay === "quick") {
    const items = TV.overlay === "options" ? optionItems() : quickItems();
    if (act === "up") { TV.menu = (TV.menu + items.length - 1) % items.length; TV.confirm = null; sfx("move"); }
    else if (act === "down") { TV.menu = (TV.menu + 1) % items.length; TV.confirm = null; sfx("move"); }
    else if (act === "b" || (act === "start" && TV.overlay === "options") || ((act === "select" || act === "guide") && TV.overlay === "quick")) { closeOverlay(); return; }
    else if (TV.overlay === "options" && (act === "left" || act === "right" || act === "a")) { optionChange(items[TV.menu], act === "left" ? -1 : 1); return; }
    else if (TV.overlay === "quick" && act === "a") { quickRun(items[TV.menu]); return; }
    else if (TV.overlay === "quick" && (act === "left" || act === "right") && items[TV.menu].id.startsWith("vol")) { api("system_volume", act === "left" ? "down" : "up"); return; }
    renderTV(); return;
  }
  const { rows, row, game: g, col } = tvFocused();
  switch (act) {
    case "left": if (row && col > 0) { TV.cols[row.id] = col - 1; sfx("move"); } TV.expanded = false; break;
    case "right": if (row && col < row.games.length - 1) { TV.cols[row.id] = col + 1; sfx("move"); } TV.expanded = false; break;
    case "up": if (TV.row > 0) { TV.row--; sfx("move"); } else if (!TV.expanded) { TV.expanded = true; sfx("move"); } break;
    case "down": if (TV.expanded) TV.expanded = false; else if (TV.row < rows.length - 1) { TV.row++; sfx("move"); } break;
    case "lb": if (TV.row > 0) { TV.row--; sfx("move"); } break;
    case "rb": if (TV.row < rows.length - 1) { TV.row++; sfx("move"); } break;
    case "a": if (g) { sfx("select"); playGame(g.id); } break;
    case "x": if (g) { sfx("select"); toggleFav(g.id); } break;
    case "y": openOverlay("keyboard"); return;
    case "start": openOverlay("options"); return;
    case "select": case "guide": openOverlay("quick"); return;
    case "b":
      if (TV.query) { TV.query = ""; TV.row = 0; sfx("back"); break; }
      sfx("back"); exitTV(); return;
  }
  renderTV();
}

function tvKey(e) {
  if (TV.overlay === "keyboard" && e.key.length === 1 && /[\p{L}\p{N} \-:'.]/u.test(e.key)) {
    e.preventDefault(); TV.query += e.key.toLowerCase(); TV.row = 0; TV.cols = {}; renderTV(); return;
  }
  if (TV.overlay === "keyboard" && e.key === "Backspace") { e.preventDefault(); kbPress(KB_KEYS.indexOf("back")); return; }
  const map = {
    ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", Enter: "a", " ": "a",
    Escape: "b", Backspace: "b", f: "x", "/": "y", s: "y", Tab: "start", q: "select", PageUp: "lb", PageDown: "rb", F11: "b",
  };
  const act = map[e.key];
  if (act) { e.preventDefault(); tvAction(act); }
}

// eventos enviados pelo programa (jogo fechou, atalho do controle)
function tvHandleEvent(ev) {
  if (ev.type === "session_end") {
    const g = gameById(ev.id);
    if (state.tv && g) toast(t("Bem-vindo de volta! Você jogou {name}.", { name: g.name }), "ok");
  } else if (ev.type === "pad_home") {
    if (!state.tv) enterTV();
    if (ev.closed?.length) toast(t("Jogo fechado pelo controle."), "ok");
  }
}

/* ---------------- Mouse ---------------- */
function bindTV() {
  $("#tv").addEventListener("click", e => {
    sfxUnlock();
    if (e.target.closest("#tv-exit")) { exitTV(); return; }
    const kb = e.target.closest("[data-kb]");
    if (kb) { TV.kb = +kb.dataset.kb; kbPress(TV.kb); return; }
    const mi = e.target.closest("[data-menu]");
    if (mi) {
      TV.menu = +mi.dataset.menu;
      const items = TV.overlay === "options" ? optionItems() : quickItems();
      TV.overlay === "options" ? optionChange(items[TV.menu]) : quickRun(items[TV.menu]);
      return;
    }
    if (e.target.id === "tv-overlay") { closeOverlay(); return; }
    const card = e.target.closest("[data-ci]");
    if (card) {
      const rows = tvRows(), ri = +card.dataset.ri, ci = +card.dataset.ci;
      const same = ri === TV.row && (TV.cols[rows[ri].id] || 0) === ci;
      TV.row = ri; TV.cols[rows[ri].id] = ci;
      if (same) tvAction("a"); else { sfx("move"); renderTV(); }
    }
  });
  $("#tv-rows").addEventListener("wheel", e => {
    e.preventDefault();
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) tvAction(e.deltaX > 0 || e.deltaY > 0 ? "right" : "left");
    else tvAction(e.deltaY > 0 ? "down" : "up");
  }, { passive: false });
}

/* ---------------- Trailer no fundo ---------------- */
const trailerCache = {};
function scheduleTrailer(g) {
  stopTrailer();
  if (!tvSetting("tv_trailers") || !g) return;
  TV.trailerTimer = setTimeout(async () => {
    if (!state.tv || TV.focusId !== g.id || TV.overlay) return;
    let url = trailerCache[g.id];
    if (url === undefined) {
      try { url = await api("get_trailer", g.id); } catch { url = null; }
      trailerCache[g.id] = url || null;
    }
    if (!url || !state.tv || TV.focusId !== g.id) return;
    const v = $("#tv-video");
    TV.trailerFor = g.id;
    v.src = url;
    v.muted = true;
    v.onplaying = () => { if (TV.trailerFor === g.id) $("#tv").classList.add("trailer-on"); };
    v.onerror = () => { trailerCache[g.id] = null; stopTrailer(); };
    v.play().catch(() => { });
  }, 2500);
}
function stopTrailer() {
  clearTimeout(TV.trailerTimer);
  TV.trailerFor = null;
  const v = $("#tv-video");
  $("#tv").classList.remove("trailer-on");
  if (v && v.getAttribute("src")) { v.pause(); v.removeAttribute("src"); v.load(); }
}

/* ---------------- Sons de navegação (sintetizados, sem arquivos) ---------------- */
let audioCtx = null;
function sfxUnlock() {
  if (!tvSetting("tv_sounds")) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch { /* sem áudio */ }
}
function sfx(kind) {
  if (!state.tv || !tvSetting("tv_sounds")) return;
  sfxUnlock();
  if (!audioCtx) return;
  const notes = { move: [[880, .035]], select: [[660, .05], [990, .07]], back: [[740, .05], [494, .07]], open: [[523, .05], [784, .08]] }[kind];
  if (!notes) return;
  let at = audioCtx.currentTime;
  for (const [freq, dur] of notes) {
    const o = audioCtx.createOscillator(), gain = audioCtx.createGain();
    o.type = "sine"; o.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(kind === "move" ? 0.035 : 0.06, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(gain).connect(audioCtx.destination);
    o.start(at); o.stop(at + dur + 0.02);
    at += dur * 0.85;
  }
}

/* ---------------- Fundo animado (partículas / scanlines conforme o tema) ---------------- */
function fxStart() {
  fxStop();
  if (!state.tv || !tvSetting("tv_fx")) return;
  const canvas = $("#tv-fx");
  const ctx = canvas.getContext("2d");
  const th = theme();
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const resize = () => { canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; };
  resize();
  const colors = th === "neon" ? ["124,92,255", "34,211,238"] : th === "cyberpunk" ? ["252,238,10", "0,240,255", "255,0,60"] : ["255,255,255", "232,163,61"];
  const parts = Array.from({ length: th === "cyberpunk" ? 26 : 46 }, () => ({
    x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 2.2, v: 0.00012 + Math.random() * 0.00035,
    a: 0.12 + Math.random() * 0.35, c: colors[Math.floor(Math.random() * colors.length)], p: Math.random() * Math.PI * 2,
  }));
  let last = 0, scan = 0;
  const frame = (ts) => {
    if (!TV.fx) return;
    TV.fx = requestAnimationFrame(frame);
    if (ts - last < 33 || document.hidden) return;  // ~30 fps
    const dt = Math.min(ts - last, 100); last = ts;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (th === "cyberpunk") {
      scan = (scan + dt * 0.12) % h;
      ctx.fillStyle = "rgba(0,240,255,0.05)"; ctx.fillRect(0, scan, w, 2 * dpr);
      if (Math.random() < 0.02) { ctx.fillStyle = `rgba(${colors[Math.floor(Math.random() * 3)]},0.08)`; ctx.fillRect(0, Math.random() * h, w, (4 + Math.random() * 18) * dpr); }
    }
    for (const q of parts) {
      q.y -= q.v * dt; q.p += dt * 0.0015;
      if (q.y < -0.02) { q.y = 1.02; q.x = Math.random(); }
      const x = (q.x + Math.sin(q.p) * 0.004) * w, y = q.y * h;
      ctx.beginPath();
      ctx.fillStyle = `rgba(${q.c},${q.a * (0.6 + 0.4 * Math.sin(q.p * 2))})`;
      if (th === "cyberpunk") ctx.fillRect(x, y, q.r * 2 * dpr, q.r * 0.8 * dpr);
      else { ctx.arc(x, y, q.r * dpr, 0, Math.PI * 2); ctx.fill(); }
    }
  };
  window.addEventListener("resize", resize);
  TV.fx = requestAnimationFrame(frame);
  canvas._resize = resize;
  canvas.hidden = false;
}
function fxStop() {
  if (TV.fx) cancelAnimationFrame(TV.fx);
  TV.fx = null;
  const canvas = $("#tv-fx");
  if (canvas) {
    if (canvas._resize) window.removeEventListener("resize", canvas._resize);
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    canvas.hidden = true;
  }
}
