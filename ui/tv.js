/* LZ Launcher - Modo TV (tela cheia para usar com controle) */
"use strict";

const TV = {
  row: 0, cols: {}, expanded: false, query: "",
  overlay: null,            // null | "keyboard" | "options" | "quick" | "trophies"
  top: null,                // tema Xbox: ícone do topo em foco (null = foco nas fileiras)
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
  ].filter(r => r.games.length);
  if (theme() === "xbox" && rows.length) rows.splice(1, 0, hubRow(games));
  return rows;
}

/* ---------------- Tema Xbox: atalhos e ícones do topo ---------------- */
const XB_ICONS = {
  library: '<svg viewBox="0 0 24 24"><path d="M4 4v16M8 4v16M12 5l4 15M16.5 4.5l4 15"/></svg>',
  trophies: '<svg viewBox="0 0 24 24"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  options: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>',
  quick: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
};
function tvIcons() {
  return [
    { id: "library", label: t("Minha biblioteca") }, { id: "trophies", label: t("Conquistas") },
    { id: "search", label: t("Buscar") }, { id: "options", label: t("Opções do Modo TV") }, { id: "quick", label: t("Menu rápido") },
  ];
}
function hubRow(games) {
  const recent = sortGames(games.filter(g => g.cover), "recent").slice(0, 3);
  const unlocked = achScore();
  return {
    id: "hub", hub: true, title: "", games: [
      { hub: "library", id: "hub:library", name: t("Minha biblioteca"), sub: t("{n} jogos", { n: games.length }), covers: recent.map(g => g.cover) },
      { hub: "trophies", id: "hub:trophies", name: t("Conquistas"), sub: t("{n} desbloqueadas", { n: unlocked }), big: unlocked },
      { hub: "search", id: "hub:search", name: t("Buscar"), sub: t("Encontre um jogo pelo nome") },
      { hub: "options", id: "hub:options", name: t("Opções do Modo TV"), sub: t("Ordem, capas, trailers e sons") },
    ],
  };
}
function hubCardHTML(h, ri, ci) {
  const art = h.hub === "library"
    ? `<div class="tv-hub-art collage">${h.covers.map(c => `<img src="${c}" alt="" loading="lazy">`).join("")}</div>`
    : h.hub === "trophies"
      ? `<div class="tv-hub-art"><span class="big">${XB_ICONS.trophies}${h.big.toLocaleString(LOCALE())}</span></div>`
      : `<div class="tv-hub-art">${XB_ICONS[h.hub]}</div>`;
  return `<div class="tv-card tv-hub h-${h.hub}" data-ri="${ri}" data-ci="${ci}">${art}<div class="tv-hub-txt"><b>${esc(h.name)}</b><small>${esc(h.sub)}</small></div></div>`;
}
function hubRun(id) {
  TV.top = null;
  sfx("select");
  if (id === "library") {
    const rows = tvRows();
    const i = rows.findIndex(r => r.id === "all");
    if (i >= 0) TV.row = i;
    renderTV();
  } else if (id === "trophies") openOverlay("trophies");
  else if (id === "search") openOverlay("keyboard");
  else if (id === "options") openOverlay("options");
  else if (id === "quick") openOverlay("quick");
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
  TV.row = 0; TV.expanded = false; TV.overlay = null; TV.top = null;
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
  tv.style.setProperty("--tv-size-k", { small: ".85", medium: "1", large: "1.15" }[tvPref("size", "medium")] || "1");
}
function tvLangChanged() { $("#tv-rows")._html = null; }

/* ---------------- Render ---------------- */
function renderTV() {
  if (!state.tv) return;
  const { rows, row, game: g } = tvFocused();
  TV.row = Math.max(0, Math.min(TV.row, rows.length - 1));

  // fileiras (o HTML só é refeito quando muda algo além do foco)
  const wrap = $("#tv-rows");
  const label = x => `<div class="tv-label"><b>${esc(x.name)}</b><small>${isRunning(x.id) ? t("Jogando agora") : fmtPlaytime(x.playtime)}${x.ach ? ` · 🏆 ${x.ach.unlocked}/${x.ach.total}` : ""}</small></div>`;
  const html = rows.map((r, ri) => r.hub ? `
    <section class="tv-row tv-hubrow" data-row="${ri}">
      <div class="tv-shelf">${r.games.map((h, ci) => hubCardHTML(h, ri, ci)).join("")}</div>
    </section>` : `
    <section class="tv-row" data-row="${ri}">
      <h2>${esc(r.title)} <span>${r.games.length}</span></h2>
      <div class="tv-shelf">${r.games.map((x, ci) => `<div class="tv-card" data-ri="${ri}" data-ci="${ci}" data-name="${esc(x.name)}">${coverHTML(x)}${isRunning(x.id) ? `<span class="tv-live">${t("Jogando")}</span>` : ""}${x.favorite ? '<span class="tv-fav">★</span>' : ""}${label(x)}</div></div>`).join("")}</div>
    </section>`).join("") || `<div class="tv-empty">${TV.query ? t("Nenhum jogo encontrado para “{q}”.", { q: esc(TV.query) }) : t("Nenhum jogo nesta aba.")}</div>`;
  if (wrap._html !== html) { wrap.innerHTML = html; wrap._html = html; }
  $$(".tv-card.focus", wrap).forEach(c => c.classList.remove("focus"));
  $$(".tv-row", wrap).forEach((el, ri) => el.classList.toggle("current", ri === TV.row));
  const cur = row && $(`.tv-card[data-ri="${TV.row}"][data-ci="${Math.max(0, Math.min(TV.cols[row.id] || 0, row.games.length - 1))}"]`, wrap);
  if (cur) {
    cur.classList.add("focus");
    const shelf = cur.parentElement;  // rola só a fileira (sem mexer na página)
    let left;
    if (theme() === "xbox") {
      // bloco em foco perto da esquerda, como no console (conta com o tamanho final, sem esperar a animação)
      const k = { small: .85, medium: 1, large: 1.15 }[tvPref("size", "medium")] || 1;
      const w = innerHeight * .142 * k * (row.hub ? 2.62 : 2 / 3), gap = parseFloat(getComputedStyle(shelf).columnGap) || 0;
      const ci = +cur.dataset.ci;
      left = ci > 0 ? (ci - 1) * (w + gap) : 0;
    } else left = cur.offsetLeft - shelf.clientWidth / 2 + cur.offsetWidth / 2;
    shelf.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
    const rowEl = cur.closest(".tv-row");
    wrap.style.setProperty("--tv-shift", `-${rowEl.offsetTop}px`);
  }

  renderTVInfo(g && !g.hub ? g : null);
  renderTVHeader();
  renderTVHints();
  renderOverlay();
  if (g && !g.hub && g.id !== TV.focusId) { TV.focusId = g.id; scheduleTrailer(g); setTVBackground(g); }
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
    g.ach ? `<span class="tv-chip ach ${g.ach.plat ? "plat" : ""}">🏆 ${g.ach.unlocked}/${g.ach.total}</span>` : "",
    ...(i.genres || []).slice(0, 2).map(x => `<span class="tv-chip">${esc(x)}</span>`),
  ].join("");
  const key = [g.id, running, Math.floor((state.running[g.id] || 0) / 5), g.playtime, g.favorite, TV.expanded, LANG, (g.history || []).length, !!g.info, JSON.stringify(g.ach || null), !!ACH.cache[g.id]].join("|");
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
    ${TV.expanded ? tvTrophyStripHTML(g) : ""}
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
  if (theme() === "xbox") {
    const icons = tvIcons().map((ic, i) => `<button class="tv-ico ${TV.top === i ? "focus" : ""}" data-top="${ic.id}" title="${esc(ic.label)}">${XB_ICONS[ic.id]}</button>`).join("");
    const nav = $("#tv-icons");
    if (nav._html !== icons) { nav.innerHTML = icons; nav._html = icons; }
  }
  $("#tv-search-chip").innerHTML = TV.query ? `<span class="tv-chip search">🔍 ${esc(TV.query)} <i class="gp b">B</i></span>` : "";
  const html = batteryHTML();
  const el = $("#tv-battery");
  if (el._html !== html) { el.innerHTML = html; el._html = html; }
}

function renderTVHints() {
  const { game: g } = tvFocused();
  const hints = TV.overlay ? [] : (TV.top !== null || g?.hub) ? [["a", "A", t("Abrir")], ["b", "B", TV.top !== null ? t("Voltar") : t("Sair do Modo TV")]] : [
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
  } else if (TV.overlay === "trophies") {
    const o = ACH.overview;
    const games = o ? o.games : [];
    const plats = games.filter(x => x.plat).length;
    const done = games.filter(x => x.total && x.unlocked === x.total).length;
    html = `<div class="tv-panel tvtrophies"><h2>${t("Conquistas")} <span class="tv-clock-sm">🏆 ${achScore().toLocaleString(LOCALE())}</span></h2>
      ${!o ? `<div class="loading"><span class="spinner"></span>${t("Carregando…")}</div>` : `
      <div class="tvt-kpis"><div><small>${t("Desbloqueadas")}</small><b>${achScore()}</b></div><div><small>${t("Platinas")}</small><b>${plats}</b></div><div><small>${t("Jogos 100%")}</small><b>${done}</b></div><div><small>${t("Jogos com conquistas")}</small><b>${games.length}</b></div></div>
      ${o.recent.length ? `<div class="tvt-list">${o.recent.slice(0, 8).map(r => `<div class="tvt">${r.icon ? `<img src="${esc(r.icon)}" alt="">` : "<img alt=\"\">"}<div><b>${esc(r.name)}</b><small>${esc(r.game)}${r.ts > 1e9 ? " · " + fmtDate(r.ts) : ""}</small></div></div>`).join("")}</div>`
        : `<p class="tv-empty" style="padding:0">${t("Nenhuma conquista desbloqueada ainda.")}</p>`}`}
      <div class="kb-hints"><span><i class="gp b">B</i>${t("Fechar")}</span></div></div>`;
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
  if (kind === "trophies") api("achievements_overview").then(o => { ACH.overview = o; if (TV.overlay === "trophies") renderTV(); }).catch(() => { });
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
  if (TV.overlay === "trophies") {
    if (act === "a" || act === "b" || act === "start") closeOverlay();
    return;
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
  if (TV.top !== null) {  // tema Xbox: ícones do topo
    const n = tvIcons().length;
    if (act === "left") { TV.top = Math.max(0, TV.top - 1); sfx("move"); }
    else if (act === "right") { TV.top = Math.min(n - 1, TV.top + 1); sfx("move"); }
    else if (act === "down" || act === "b") { TV.top = null; sfx("move"); }
    else if (act === "a") { hubRun(tvIcons()[TV.top].id); return; }
    else if (["y", "start", "select", "guide"].includes(act)) { TV.top = null; }
    else return;
    if (TV.top !== null) { renderTV(); return; }
    if (!["y", "start", "select", "guide"].includes(act)) { renderTV(); return; }
  }
  const { rows, row, game: g, col } = tvFocused();
  switch (act) {
    case "left": if (row && col > 0) { TV.cols[row.id] = col - 1; sfx("move"); } TV.expanded = false; break;
    case "right": if (row && col < row.games.length - 1) { TV.cols[row.id] = col + 1; sfx("move"); } TV.expanded = false; break;
    case "up": if (TV.row > 0) { TV.row--; sfx("move"); } else if (theme() === "xbox") { TV.top = 0; sfx("move"); } else if (!TV.expanded) { TV.expanded = true; sfx("move"); } break;
    case "down": if (TV.expanded) TV.expanded = false; else if (TV.row < rows.length - 1) { TV.row++; sfx("move"); } break;
    case "lb": if (TV.row > 0) { TV.row--; sfx("move"); } break;
    case "rb": if (TV.row < rows.length - 1) { TV.row++; sfx("move"); } break;
    case "a": if (g?.hub) { hubRun(g.hub); return; } if (g) { sfx("select"); playGame(g.id); } break;
    case "x": if (g && !g.hub) { sfx("select"); toggleFav(g.id); } break;
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
    const top = e.target.closest("[data-top]");
    if (top) { hubRun(top.dataset.top); return; }
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
  if (!state.tv || !tvSetting("tv_fx") || theme() === "xbox") return;
  const canvas = $("#tv-fx");
  const ctx = canvas.getContext("2d");
  const th = theme();
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const resize = () => { canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; };
  resize();
  const colors = th === "neon" ? ["124,92,255", "34,211,238"] : th === "cyberpunk" ? ["252,238,10", "0,240,255", "255,0,60"]
    : th === "midnight" ? ["255,255,255", "200,212,255", "169,188,255"] : ["255,255,255", "232,163,61"];
  let shooting = null;
  const parts = Array.from({ length: th === "cyberpunk" ? 26 : th === "midnight" ? 90 : 46 }, () => ({
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
    if (th === "midnight") {
      // estrelas paradas que piscam + uma estrela cadente de vez em quando
      for (const q of parts) {
        q.p += dt * 0.002;
        ctx.beginPath();
        ctx.fillStyle = `rgba(${q.c},${0.25 + 0.6 * Math.abs(Math.sin(q.p))})`;
        ctx.arc(q.x * w, q.y * h * 0.75, q.r * 0.7 * dpr, 0, Math.PI * 2); ctx.fill();
      }
      if (!shooting && Math.random() < 0.004) shooting = { x: 0.3 + Math.random() * 0.7, y: Math.random() * 0.3, life: 0 };
      if (shooting) {
        shooting.life += dt;
        const k = shooting.life / 900, x = (shooting.x - k * 0.35) * w, y = (shooting.y + k * 0.18) * h;
        const grad = ctx.createLinearGradient(x, y, x + 140 * dpr, y - 70 * dpr);
        grad.addColorStop(0, `rgba(255,255,255,${0.9 * (1 - k)})`); grad.addColorStop(1, "rgba(255,255,255,0)");
        ctx.strokeStyle = grad; ctx.lineWidth = 1.6 * dpr;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 140 * dpr, y - 70 * dpr); ctx.stroke();
        if (k >= 1) shooting = null;
      }
      return;
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
