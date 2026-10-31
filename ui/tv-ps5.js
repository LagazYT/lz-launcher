/* LZ Launcher - Modo TV no tema PS5 (tela inicial no estilo do console) */
"use strict";

const PS = { zone: "row", tab: 0, col: {}, pill: 0, card: 0, top: 0, drives: null, drivesAt: 0, overview: null, ovAt: 0 };

const PS_ICONS = {
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  options: XB_ICONS.options,
  trophy: XB_ICONS.trophies,
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"/></svg>',
  disk: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>',
  pad: PAD_ICON,
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  chart: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></svg>',
};

function psTabs() {
  return [
    { id: "all", label: t("Jogos") }, { id: "recompiled", label: t("Recompilados") },
    { id: "normal", label: t("Jogos de PC") }, { id: "favorites", label: t("Favoritos") },
  ];
}
function psTopItems() {  // abas + ícones da direita, na ordem da navegação
  return [...psTabs().map(x => ({ ...x, kind: "tab" })), { id: "search", kind: "icon" }, { id: "options", kind: "icon" }, { id: "quick", kind: "icon" }];
}
function psGames() {
  const games = state.lib.games.filter(g => !g.hidden);
  const q = TV.query.trim().toLowerCase();
  if (q) return sortGames(games.filter(g => g.name.toLowerCase().includes(q) || (g.info?.genres || []).some(x => x.toLowerCase().includes(q))), "name");
  const tab = psTabs()[PS.tab].id;
  const list = tab === "all" ? games : tab === "favorites" ? games.filter(g => g.favorite) : games.filter(g => g.kind === tab);
  const sort = tvSort();
  // como no console: os jogados por último primeiro (a ordem pode ser trocada nas opções)
  return sortGames([...list], sort);
}
function psFocused() {
  const list = psGames();
  const key = TV.query ? "q" : PS.tab;
  const col = Math.max(0, Math.min(PS.col[key] || 0, list.length - 1));
  return { list, col, game: list[col] || null, key };
}

/* ---------------- dados dos cartões (atualizados de tempos em tempos) ---------------- */
function psLoadData() {
  const now = Date.now();
  if (now - PS.drivesAt > 60000) {
    PS.drivesAt = now;
    api("drives").then(d => { PS.drives = d; if (state.tv && theme() === "ps5") renderTV(); }).catch(() => { });
  }
  if (now - PS.ovAt > 30000) {
    PS.ovAt = now;
    api("achievements_overview").then(o => { PS.overview = o; ACH.overview = o; if (state.tv && theme() === "ps5") renderTV(); }).catch(() => { });
  }
}

const fmtGB = b => (b / 1073741824).toLocaleString(LOCALE(), { maximumFractionDigits: b > 1e12 ? 0 : 1 }) + " GB";
const tileImg = g => g.tile ? `<img src="${g.tile}" alt="" loading="lazy">` : g.cover ? `<img src="${g.cover}" alt="" loading="lazy">` : "";

function psRing(pct, size = 2.4) {
  const r = 15.9, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(1, pct)));
  return `<svg class="ps-ring" viewBox="0 0 36 36" style="width:${size}em;height:${size}em"><circle cx="18" cy="18" r="${r}" class="bg"/><circle cx="18" cy="18" r="${r}" class="fg" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/></svg>`;
}
function psTrophy(type) {
  return `<span class="ps-trophy ${type}"><svg viewBox="0 0 24 24"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg></span>`;
}

function psCards(g) {
  const games = state.lib.games.filter(x => !x.hidden);
  const o = PS.overview;
  const types = o?.types || { platinum: 0, gold: 0, silver: 0, bronze: 0, other: 0 };
  const total = achScore();
  const level = 1 + Math.floor(total / 12), lvlPct = Math.round((total % 12) / 12 * 100);
  const added = [...games].sort((a, b) => (b.added || 0) - (a.added || 0))[0];
  const favs = games.filter(x => x.favorite);
  const most = [...games].sort((a, b) => b.playtime - a.playtime)[0];
  const totalTime = games.reduce((s, x) => s + (x.playtime || 0), 0);
  const recent = games.filter(x => x.last_played).sort((a, b) => b.last_played - a.last_played).slice(0, 3);
  const p = state.pad;
  const bat = p?.battery;
  const batPct = !p?.connected ? 0 : bat?.wired ? 1 : ({ empty: .05, low: .3, medium: .65, full: 1 }[bat?.level] ?? 1);
  const i = g?.info || {};
  const cards = [
    { id: "trophies", cls: "c-trophies", html: `
      <header>${PS_ICONS.trophy}<b>${t("Conquistas")}</b><span>${t("Total")}: ${total.toLocaleString(LOCALE())}</span></header>
      <div class="ps-tro">${["platinum", "gold", "silver", "bronze"].map(tp => `<div>${psTrophy(tp)}<b>${types[tp]}</b></div>`).join("")}<div>${psTrophy("pc")}<b>${types.other}</b></div></div>
      <footer><span class="ps-lvl">${psTrophy("bronze")}${t("Nível {n}", { n: level })}</span><span>${lvlPct}%</span></footer>
      <i class="ps-bar"><i style="width:${lvlPct}%"></i></i>` },
    { id: "about", cls: "c-about", bg: g?.hero || g?.cover, html: g ? `
      <header>${PS_ICONS.info}<b>${t("Sobre o jogo")}</b></header>
      <div class="ps-about-txt"><span class="ps-playdot">${PS_ICONS.play}</span><b>${esc(g.name)}</b>
      <small>${esc([(i.developers || [])[0], i.year, (i.genres || [])[0]].filter(Boolean).join("  |  ") || platformLabel(g))}</small></div>` : "" },
    { id: "added", cls: "c-added", html: added ? `
      <header>${PS_ICONS.plus}<b>${t("Adicionado recentemente")}</b></header>
      <div class="ps-side"><span>${esc(added.name)}</span><div class="ps-mini">${tileImg(added)}</div></div>` : "" },
    { id: "favorites", cls: "c-favs", html: `
      <header>${PS_ICONS.star}<b>${t("Favoritos")}</b><span class="ps-count"><i></i>${favs.length}</span></header>
      <div class="ps-avatars">${favs.slice(0, 9).map(x => `<span>${tileImg(x)}</span>`).join("") || `<small>${t("Aperte X num jogo para favoritar.")}</small>`}</div>
      <small class="ps-names">${esc(favs.slice(0, 4).map(x => x.name).join(", "))}${favs.length > 4 ? ", …" : ""}</small>` },
    { id: "storage", cls: "c-storage", html: `
      <header>${PS_ICONS.disk}<b>${t("Armazenamento")}</b></header>
      ${[...(PS.drives || [])].sort((a, b) => b.games - a.games).slice(0, 2).map(d => {
        const used = 1 - d.free / d.total;
        return `<div class="ps-drive"><span>${d.drive} <small>${t("{n} jogos", { n: d.games })}</small></span><i class="ps-bar"><i style="width:${Math.round(used * 100)}%"></i></i><span>${t("{gb} livres", { gb: fmtGB(d.free) })}</span></div>`;
      }).join("") || `<small>${t("Carregando…")}</small>`}
      ${(PS.drives || []).length > 2 ? `<small class="ps-more">${t("+{n} discos", { n: PS.drives.length - 2 })}</small>` : ""}` },
    { id: "pad", cls: "c-pad", html: `
      <div class="ps-padring">${psRing(batPct, 3.6)}<span>${PS_ICONS.pad}</span></div>
      <div><b>${p?.connected ? t("Controle conectado") : t("Nenhum controle conectado")}</b>
      <small>${!p?.connected ? t("Conecte um controle para navegar") : bat?.wired || !bat?.level ? t("Com fio") : t("Bateria do controle") + ": " + { empty: t("vazia"), low: t("fraca"), medium: t("média"), full: t("cheia") }[bat.level]}</small></div>` },
    { id: "most", cls: "c-most", bg: most?.hero || most?.cover, html: most ? `
      <header>${PS_ICONS.chart}<b>${t("Mais jogado")}</b></header>
      <div class="ps-most"><b>${esc(most.name)}</b><small>${fmtPlaytime(most.playtime)} · ${t("total de {t}", { t: fmtPlaytime(totalTime) })}</small></div>` : "" },
    { id: "activity", cls: "c-activity", html: `
      <header>${PS_ICONS.clock}<b>${t("Atividade recente")}</b></header>
      ${recent.map(x => `<div class="ps-act"><div class="ps-mini">${tileImg(x)}</div><div><b>${esc(x.name)}</b><small>${fmtAgo(x.last_played)} · ${fmtPlaytime(x.playtime)}</small></div></div>`).join("") || `<small>${t("Nenhum jogo jogado ainda.")}</small>`}` },
  ];
  return cards.filter(c => c.html);
}

/* ---------------- render ---------------- */
function setHTMLonce(el, html) { if (el._html !== html) { el.innerHTML = html; el._html = html; } }

function renderPS5() {
  psLoadData();
  const { list, col, game: g } = psFocused();
  const wrap = $("#tv-rows");
  if (!wrap.querySelector(".ps-home")) { wrap.innerHTML = `<div class="ps-home"><div class="ps-row"><div class="ps-shelf"></div></div><div class="ps-pills"></div><div class="ps-cards"><div class="ps-grid"></div></div></div>`; wrap._html = null; }

  // topo: abas e ícones
  const top = psTopItems();
  const tabsHTML = psTabs().map((x, i) => `<button class="ps-tab ${i === PS.tab && !TV.query ? "on" : ""} ${PS.zone === "top" && PS.top === i ? "focus" : ""}" data-pstop="${i}">${esc(x.label)}</button>`).join("");
  setHTMLonce($("#tv-icons"), tabsHTML);
  const iconsHTML = top.slice(psTabs().length).map((x, k) => {
    const i = k + psTabs().length;
    const inner = x.id === "quick" ? `<img src="icon.png" alt="">` : PS_ICONS[x.id];
    return `<button class="ps-ico ${x.id === "quick" ? "avatar" : ""} ${PS.zone === "top" && PS.top === i ? "focus" : ""}" data-pstop="${i}" title="${esc(x.id === "search" ? t("Buscar") : x.id === "options" ? t("Opções do Modo TV") : profileName() + " · " + t("Menu rápido"))}">${inner}</button>`;
  }).join("");
  setHTMLonce($("#tv-ps-actions"), iconsHTML);

  // fileira de blocos
  const shelf = wrap.querySelector(".ps-shelf");
  const shelfHTML = list.map((x, ci) => `<div class="ps-tile" data-psc="${ci}">
      <div class="ps-tile-img">${tileImg(x) || `<span class="ph">${esc(x.name)}</span>`}${isRunning(x.id) ? `<span class="ps-live">${t("Jogando")}</span>` : ""}</div>
      <div class="ps-name">${esc(x.name)}</div></div>`).join("")
    || `<div class="tv-empty">${TV.query ? t("Nenhum jogo encontrado para “{q}”.", { q: esc(TV.query) }) : t("Nenhum jogo nesta aba.")}</div>`;
  setHTMLonce(shelf, shelfHTML);
  $$(".ps-tile.focus", shelf).forEach(x => x.classList.remove("focus"));
  const cur = shelf.querySelector(`.ps-tile[data-psc="${col}"]`);
  if (cur) {
    cur.classList.add("focus");
    cur.classList.toggle("dim", PS.zone !== "row");
    const s = innerHeight * .098, gap = parseFloat(getComputedStyle(shelf).columnGap) || 0;
    shelf.style.transform = `translateX(${-col * (s + gap)}px)`;  // o bloco em foco fica sempre no mesmo lugar, como no console
  }

  // ações do jogo em foco
  const ach = g?.ach;
  const pct = ach && ach.total ? ach.unlocked / ach.total : 0;
  const pills = g ? [
    { id: "play", html: `${PS_ICONS.play}<span>${isRunning(g.id) ? t("Jogando agora") : t("Jogar")}</span>`, cls: "primary" },
    ach ? { id: "trophies", html: `${psRing(pct, 1.9)}<b>${Math.round(pct * 100)}%</b><span>${esc(g.name)}</span>` } : { id: "time", html: `${PS_ICONS.clock}<span>${fmtPlaytime(g.playtime)} · ${t("Última vez")}: ${fmtAgo(g.last_played)}</span>` },
    { id: "fav", html: `${PS_ICONS.star}<span>${g.favorite ? t("Remover favorito") : t("Favoritar")}</span>`, cls: g.favorite ? "on" : "" },
  ] : [];
  PS.pill = Math.min(PS.pill, Math.max(0, pills.length - 1));
  setHTMLonce(wrap.querySelector(".ps-pills"), pills.map((x, i) => `<button class="ps-pill ${x.cls || ""} ${PS.zone === "pills" && PS.pill === i ? "focus" : ""}" data-pspill="${i}" data-act="${x.id}">${x.html}</button>`).join(""));

  // cartões
  const cards = psCards(g);
  PS.card = Math.min(PS.card, cards.length - 1);
  const grid = wrap.querySelector(".ps-grid");
  setHTMLonce(grid, cards.map((c, i) => `<div class="ps-card ${c.cls} ${PS.zone === "cards" && PS.card === i ? "focus" : ""}" data-pscard="${i}" data-id="${c.id}">
      ${c.bg ? `<img class="ps-card-bg" src="${c.bg}" alt="" loading="lazy">` : ""}<div class="ps-card-in">${c.html}</div></div>`).join(""));
  // rola os cartões na horizontal até o que está em foco
  const fc = grid.querySelector(".ps-card.focus");
  const box = wrap.querySelector(".ps-cards");
  if (fc) {
    const over = fc.offsetLeft + fc.offsetWidth - (box.clientWidth - innerWidth * .04);
    grid.style.transform = `translateX(${-Math.max(0, over)}px)`;
  } else grid.style.transform = "";

  $("#tv").dataset.pszone = PS.zone;
  renderTVHeader();
  renderTVHints();
  renderOverlay();
  if (g && g.id !== TV.focusId) { TV.focusId = g.id; scheduleTrailer(g); setTVBackground(g); }
}

/* ---------------- controle ---------------- */
// posição de cada cartão na grade (coluna, linha, altura em linhas) — igual ao grid-template-areas do CSS
const PS_AREAS = { trophies: [0, 0, 2], about: [1, 0, 2], added: [2, 0, 1], favorites: [2, 1, 1], activity: [3, 0, 3], storage: [0, 2, 1], pad: [1, 2, 1], most: [2, 2, 1] };
function psCardMove(dir) {
  const ids = $$("#tv-rows .ps-card").map(c => c.dataset.id);
  const cur = PS_AREAS[ids[PS.card]];
  if (!cur) return false;
  const [c, r, span] = cur;
  if (PS.crow == null || PS.crow < r || PS.crow >= r + span) PS.crow = r;
  const at = (col, row) => ids.findIndex(id => { const a = PS_AREAS[id]; return a && a[0] === col && row >= a[1] && row < a[1] + a[2]; });
  let target = -1;
  if (dir === "left" || dir === "right") {
    const col = c + (dir === "right" ? 1 : -1);
    target = at(col, PS.crow);
    for (let k = 0; target < 0 && k < 3; k++) target = at(col, k);
  } else {
    const row = dir === "down" ? r + span : r - 1;
    if (row < 0 || row > 2) return false;
    target = at(c, row);
    if (target >= 0) PS.crow = row;
  }
  if (target < 0) return false;
  PS.card = target;
  return true;
}

function psCardRun(id) {
  sfx("select");
  const { list } = psFocused();
  if (id === "trophies") openOverlay("trophies");
  else if (id === "about") openOverlay("about");
  else if (id === "favorites") { PS.tab = psTabs().findIndex(x => x.id === "favorites"); PS.zone = "row"; renderTV(); }
  else if (id === "pad") openOverlay("quick");
  else if (id === "added" || id === "most") {
    const games = state.lib.games.filter(x => !x.hidden);
    const target = id === "added" ? [...games].sort((a, b) => (b.added || 0) - (a.added || 0))[0] : [...games].sort((a, b) => b.playtime - a.playtime)[0];
    if (target) { TV.query = ""; PS.tab = 0; const i = psGames().findIndex(x => x.id === target.id); PS.col[0] = Math.max(0, i); PS.zone = "row"; }
    renderTV();
  } else if (id === "storage") { /* só informação */ }
}

function psTopRun(i) {
  const item = psTopItems()[i];
  if (!item) return;
  sfx("select");
  if (item.kind === "tab") { PS.tab = i; TV.query = ""; PS.zone = "row"; renderTV(); }
  else if (item.id === "search") openOverlay("keyboard");
  else if (item.id === "options") openOverlay("options");
  else if (item.id === "quick") openOverlay("quick");
}

function psAction(act) {
  const { list, col, game: g, key } = psFocused();
  const n = psTopItems().length;
  const tabs = psTabs().length;
  if (act === "lb" || act === "rb") { PS.tab = (PS.tab + (act === "rb" ? 1 : tabs - 1)) % tabs; TV.query = ""; PS.zone = "row"; sfx("move"); renderTV(); return; }
  if (act === "y") { openOverlay("keyboard"); return; }
  if (act === "start") { openOverlay("options"); return; }
  if (act === "select" || act === "guide") { openOverlay("quick"); return; }
  switch (PS.zone) {
    case "top":
      if (act === "left" && PS.top > 0) PS.top--;
      else if (act === "right" && PS.top < n - 1) PS.top++;
      else if (act === "down" || act === "b") PS.zone = "row";
      else if (act === "a") { psTopRun(PS.top); return; }
      else return;
      break;
    case "row":
      if (act === "left" && col > 0) PS.col[key] = col - 1;
      else if (act === "right" && col < list.length - 1) PS.col[key] = col + 1;
      else if (act === "up") { PS.zone = "top"; PS.top = TV.query ? tabs : PS.tab; }
      else if (act === "down" && g) { PS.zone = "pills"; PS.pill = 0; }
      else if (act === "a" && g) { sfx("select"); playGame(g.id); return; }
      else if (act === "x" && g) { sfx("select"); toggleFav(g.id); return; }
      else if (act === "b") { if (TV.query) { TV.query = ""; sfx("back"); renderTV(); return; } sfx("back"); exitTV(); return; }
      else return;
      break;
    case "pills": {
      const pills = $$("#tv-rows .ps-pill");
      if (act === "left" && PS.pill > 0) PS.pill--;
      else if (act === "right" && PS.pill < pills.length - 1) PS.pill++;
      else if (act === "up" || act === "b") PS.zone = "row";
      else if (act === "down") { PS.zone = "cards"; PS.card = 0; PS.crow = 0; }
      else if (act === "a") { psPillRun(pills[PS.pill]?.dataset.act); return; }
      else return;
      break;
    }
    case "cards":
      if (["left", "right", "up", "down"].includes(act)) {
        if (!psCardMove(act)) { if (act === "up") PS.zone = "pills"; else return; }
      } else if (act === "b") PS.zone = "row";
      else if (act === "a") { psCardRun($$("#tv-rows .ps-card")[PS.card]?.dataset.id); return; }
      else return;
      break;
  }
  sfx("move");
  renderTV();
}

function psPillRun(id) {
  const { game: g } = psFocused();
  if (!g) return;
  sfx("select");
  if (id === "play") playGame(g.id);
  else if (id === "trophies") openOverlay("trophies");
  else if (id === "fav") toggleFav(g.id);
  else if (id === "time") openOverlay("about");
}

function psClick(e) {
  const tp = e.target.closest("[data-pstop]");
  if (tp) { PS.zone = "top"; PS.top = +tp.dataset.pstop; psTopRun(PS.top); return true; }
  const tile = e.target.closest("[data-psc]");
  if (tile) {
    const { key, col } = psFocused();
    const ci = +tile.dataset.psc;
    if (PS.zone === "row" && ci === col) psAction("a");
    else { PS.col[key] = ci; PS.zone = "row"; sfx("move"); renderTV(); }
    return true;
  }
  const pill = e.target.closest("[data-pspill]");
  if (pill) { PS.zone = "pills"; PS.pill = +pill.dataset.pspill; psPillRun(pill.dataset.act); return true; }
  const card = e.target.closest("[data-pscard]");
  if (card) { PS.zone = "cards"; PS.card = +card.dataset.pscard; psCardRun(card.dataset.id); return true; }
  return false;
}

/* janela "Sobre o jogo" */
function psAboutHTML() {
  const { game: g } = psFocused();
  if (!g) return "";
  const i = g.info || {};
  return `<div class="tv-panel ps-aboutpanel"><h2>${esc(g.name)} <span class="tv-clock-sm">${esc(platformLabel(g))}</span></h2>
    <div class="tvt-kpis"><div><small>${t("Tempo de jogo")}</small><b>${fmtPlaytime(g.playtime)}</b></div><div><small>${t("Última vez")}</small><b>${fmtAgo(g.last_played)}</b></div>${g.ach ? `<div><small>${t("Conquistas")}</small><b>${g.ach.unlocked}/${g.ach.total}</b></div>` : ""}${i.metacritic ? `<div><small>Metacritic</small><b>${i.metacritic}</b></div>` : ""}</div>
    ${i.description ? `<p class="ps-desc">${esc(i.description)}</p>` : ""}
    ${i.developers?.length ? `<p class="tv-more">${t("Desenvolvedora")}: ${esc(i.developers.join(", "))}${i.publishers?.length ? " · " + t("Publicadora") + ": " + esc(i.publishers.join(", ")) : ""}</p>` : ""}
    <div class="kb-hints"><span><i class="gp a">A</i>${t("Jogar")}</span><span><i class="gp b">B</i>${t("Fechar")}</span></div></div>`;
}
