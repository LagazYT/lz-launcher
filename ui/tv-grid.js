/* LZ Launcher - Modo TV: "Minha biblioteca", todos os jogos em grade (em todos os temas) */
"use strict";

const GRID = { open: false, tab: 0, idx: {}, cols: 6 };

function gridTabs() {
  return [
    { id: "all", label: t("Todos") }, { id: "recompiled", label: t("Recompilados") },
    { id: "normal", label: t("Jogos de PC") }, { id: "favorites", label: t("Favoritos") },
  ];
}
function gridGames() {
  const games = state.lib.games.filter(g => !g.hidden);
  const q = TV.query.trim().toLowerCase();
  const tab = gridTabs()[GRID.tab].id;
  let list = tab === "all" ? games : tab === "favorites" ? games.filter(g => g.favorite) : games.filter(g => g.kind === tab);
  if (q) list = list.filter(g => g.name.toLowerCase().includes(q) || (g.info?.genres || []).some(x => x.toLowerCase().includes(q)));
  return sortGames([...list], tvSort() === "recent" ? "recent" : tvSort());
}
function gridKey() { return GRID.tab + "|" + TV.query; }
function gridFocused() {
  const list = gridGames();
  const i = Math.max(0, Math.min(GRID.idx[gridKey()] || 0, list.length - 1));
  return { list, i, game: list[i] || null };
}
const gridSquare = () => ["xbox", "ps5"].includes(theme());

function openGrid() {
  if (GRID.open) { closeGrid(); return; }
  GRID.open = true;
  $("#tv-grid")._html = null;
  sfx("open");
  renderTV();
}
function closeGrid() {
  GRID.open = false;
  sfx("back");
  renderTV();
}

function renderTVGrid() {
  const box = $("#tv-grid");
  box.hidden = !GRID.open;
  $("#tv").classList.toggle("grid-on", GRID.open);
  if (!GRID.open) return;
  const { list, i, game: g } = gridFocused();
  const sq = gridSquare();
  const tabs = gridTabs().map((x, k) => `<button class="tg-tab ${k === GRID.tab ? "on" : ""}" data-gtab="${k}">${esc(x.label)}</button>`).join("");
  const cards = list.map((x, k) => `<div class="tg-card" data-gi="${k}">
      ${sq && x.tile ? `<div class="cover tile"><img src="${x.tile}" alt="" loading="lazy">` : coverHTML(x)}${isRunning(x.id) ? `<span class="tv-live">${t("Jogando")}</span>` : ""}${x.favorite ? '<span class="tv-fav">★</span>' : ""}</div>
    </div>`).join("") || `<div class="tv-empty">${TV.query ? t("Nenhum jogo encontrado para “{q}”.", { q: esc(TV.query) }) : t("Nenhum jogo nesta aba.")}</div>`;
  const html = `
    <header class="tg-head">
      <div class="tg-title"><h1>${t("Minha biblioteca")}</h1><span>${t(list.length === 1 ? "{n} jogo" : "{n} jogos", { n: list.length })}</span></div>
      <div class="tg-tabs"><i class="gp lbrb">LB</i>${tabs}<i class="gp lbrb">RB</i></div>
      ${TV.query ? `<span class="tv-chip search">🔍 ${esc(TV.query)}</span>` : ""}
      <button class="tg-close" data-gclose title="${t("Fechar")}"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
    </header>
    <div class="tg-scroll"><div class="tg-grid ${sq ? "square" : ""}">${cards}</div></div>`;
  if (box._html !== html) { box.innerHTML = html; box._html = html; }
  $$(".tg-card.focus", box).forEach(x => x.classList.remove("focus"));
  const cur = box.querySelector(`.tg-card[data-gi="${i}"]`);
  if (cur) {
    cur.classList.add("focus");
    const sc = box.querySelector(".tg-scroll");
    const top = cur.offsetTop, bottom = top + cur.offsetHeight;
    if (top - 20 < sc.scrollTop) sc.scrollTo({ top: Math.max(0, top - 20), behavior: "smooth" });
    else if (bottom + 30 > sc.scrollTop + sc.clientHeight) sc.scrollTo({ top: bottom + 30 - sc.clientHeight, behavior: "smooth" });
  }
  // rodapé: jogo em foco e botões
  const foot = g ? `<div class="tg-info"><b>${esc(g.name)}</b><span>${esc(platformLabel(g))} · ${isRunning(g.id) ? t("Jogando agora") : fmtPlaytime(g.playtime)}${g.ach ? ` · 🏆 ${g.ach.unlocked}/${g.ach.total}` : ""}</span></div>` : "<div></div>";
  const hints = [["a", "A", t("Jogar")], ["x", "X", g?.favorite ? t("Remover favorito") : t("Favoritar")], ["y", "Y", t("Buscar")], ["b", "B", TV.query ? t("Limpar busca") : t("Voltar")]]
    .map(([c, k, l]) => `<span><i class="gp ${c}">${k}</i>${l}</span>`).join("");
  let f = box.querySelector(".tg-foot");
  if (!f) { f = document.createElement("footer"); f.className = "tg-foot"; box.appendChild(f); }
  const fh = foot + `<div class="tg-hints">${hints}</div>`;
  if (f._html !== fh) { f.innerHTML = fh; f._html = fh; }
  if (g && g.id !== TV.focusId) { TV.focusId = g.id; setTVBackground(g); stopTrailer(); }
}

function gridCols() {
  const grid = $("#tv-grid .tg-grid");
  const n = grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length : 0;
  return n || GRID.cols;
}

function gridAction(act) {
  const { list, i, game: g } = gridFocused();
  const cols = gridCols();
  const key = gridKey();
  const tabs = gridTabs().length;
  switch (act) {
    case "left": if (i > 0) GRID.idx[key] = i - 1; else return; break;
    case "right": if (i < list.length - 1) GRID.idx[key] = i + 1; else return; break;
    case "up": if (i - cols >= 0) GRID.idx[key] = i - cols; else return; break;
    case "down": if (i + cols < list.length) GRID.idx[key] = i + cols; else if (Math.floor(i / cols) < Math.floor((list.length - 1) / cols)) GRID.idx[key] = list.length - 1; else return; break;
    case "lb": case "rb": GRID.tab = (GRID.tab + (act === "rb" ? 1 : tabs - 1)) % tabs; break;
    case "a": if (g) { sfx("select"); playGame(g.id); } return;
    case "x": if (g) { sfx("select"); toggleFav(g.id); } return;
    case "y": openOverlay("keyboard"); return;
    case "start": openOverlay("options"); return;
    case "select": case "guide": openOverlay("quick"); return;
    case "b": if (TV.query) { TV.query = ""; sfx("back"); renderTV(); return; } closeGrid(); return;
    case "rt": closeGrid(); return;
    default: return;
  }
  sfx("move");
  renderTV();
}

function gridClick(e) {
  if (!GRID.open) return false;
  if (e.target.closest("[data-gclose]")) { closeGrid(); return true; }
  const tab = e.target.closest("[data-gtab]");
  if (tab) { GRID.tab = +tab.dataset.gtab; sfx("move"); renderTV(); return true; }
  const card = e.target.closest("[data-gi]");
  if (card) {
    const k = +card.dataset.gi, key = gridKey();
    if ((GRID.idx[key] || 0) === k) gridAction("a"); else { GRID.idx[key] = k; sfx("move"); renderTV(); }
    return true;
  }
  return e.target.closest("#tv-grid") ? true : false;
}
