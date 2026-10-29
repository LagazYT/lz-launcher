/* LZ Launcher - Troféus e conquistas */
"use strict";

const ACH = { cache: {}, loading: {}, sum: {}, filter: "all", overview: null };

function achWord(kind, plural) {
  if (kind === "psn") return plural ? t("Troféus") : t("Troféu");
  return plural ? t("Conquistas") : t("Conquista");
}
function typeLabel(type) {
  return { platinum: t("Platina"), gold: t("Ouro"), silver: t("Prata"), bronze: t("Bronze") }[type] || "";
}

const TROPHY_SVG = '<svg viewBox="0 0 24 24"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>';
function fmtRar(p) { return String(p).replace(".", LANG === "en" ? "." : ",") + "%"; }

// selo de progresso nos cards da biblioteca
function trophyBadge(g) {
  if (!g.ach || !g.ach.total) return "";
  const full = g.ach.unlocked === g.ach.total;
  return `<span class="c-ach ${g.ach.plat ? "plat" : ""} ${full ? "full" : ""}" title="${esc(achWord(g.ach.kind, true))}">${TROPHY_SVG}${g.ach.unlocked}/${g.ach.total}</span>`;
}

async function loadAch(id, force = false) {
  if (!force && ACH.cache[id]) return ACH.cache[id];
  if (ACH.loading[id]) return ACH.loading[id];
  ACH.loading[id] = api("get_achievements", id).then(d => { ACH.cache[id] = d || { empty: true }; delete ACH.loading[id]; return ACH.cache[id]; })
    .catch(() => { delete ACH.loading[id]; return null; });
  return ACH.loading[id];
}

/* ---------------- Página do jogo ---------------- */
function renderDetailsTrophies(g, full) {
  const sec = $("#d-trophies-sec");
  if (!g.ach) { sec.hidden = true; return; }
  sec.hidden = false;
  $("#d-trophies-title").textContent = achWord(g.ach.kind, true);
  const sum = JSON.stringify(g.ach);
  if (ACH.sum[g.id] !== sum) { ACH.sum[g.id] = sum; delete ACH.cache[g.id]; }  // a lista mudou no programa
  const data = ACH.cache[g.id];
  if (!data) {
    $("#d-trophies").innerHTML = `<div class="loading"><span class="spinner"></span>${t("Carregando…")}</div>`;
    loadAch(g.id).then(() => { if (state.current === g.id) renderDetailsTrophies(gameById(g.id) || g, true); });
    return;
  }
  const key = JSON.stringify([g.ach, ACH.filter, LANG, data.list?.length]);
  const box = $("#d-trophies");
  if (!full && box._key === key) return;
  box._key = key;
  box.innerHTML = achListHTML(data, g);
}

function achProgressHTML(d) {
  const pct = d.total ? Math.round((d.unlocked / d.total) * 100) : 0;
  const counts = {};
  if (d.kind === "psn") for (const a of d.list) if (a.unlocked) counts[a.type] = (counts[a.type] || 0) + 1;
  return `<div class="ach-progress">
    <div class="ach-pnum"><b>${d.unlocked}</b>/${d.total}<span>${pct}%</span></div>
    <div class="ach-pbar"><i style="width:${pct}%"></i></div>
    ${d.kind === "psn" ? `<div class="ach-types">${["platinum", "gold", "silver", "bronze"].map(tp => `<span class="tt ${tp}" title="${typeLabel(tp)}"><i></i>${counts[tp] || 0}</span>`).join("")}</div>` : ""}
  </div>`;
}

function achItemHTML(a, kind) {
  const secret = a.hidden && !a.unlocked;
  const icon = (a.unlocked ? a.icon : (a.icon_gray || a.icon));
  return `<div class="ach ${a.unlocked ? "on" : "off"} ${secret ? "secret" : ""}">
    <div class="ach-icon">${icon ? `<img src="${esc(icon)}" alt="" loading="lazy" onerror="this.remove()">` : ""}</div>
    <div class="ach-body">
      <div class="ach-name">${kind === "psn" && a.type ? `<span class="tt ${a.type}" title="${typeLabel(a.type)}"><i></i></span>` : ""}${secret ? t("Conquista secreta") : esc(a.name)}</div>
      <div class="ach-desc">${secret ? t("Continue jogando para descobrir.") : esc(a.desc || "")}</div>
    </div>
    <div class="ach-meta">
      ${a.rarity != null ? `<span class="ach-rar ${a.rarity < 5 ? "ultra" : a.rarity < 15 ? "rare" : ""}">${fmtRar(a.rarity)}</span>` : ""}
      ${a.unlocked ? `<span class="ach-date">${a.unlocked > 1e9 ? fmtDate(a.unlocked) : "✓"}</span>` : ""}
    </div>
  </div>`;
}

function achListHTML(d, g) {
  if (!d || d.empty || !d.list) return `<p class="hint">${t("Nenhuma conquista encontrada para este jogo.")}</p>`;
  const filt = a => ACH.filter === "all" || (ACH.filter === "on" ? a.unlocked : !a.unlocked);
  let list = d.list.filter(filt);
  // desbloqueadas primeiro (mais recentes no topo), depois as bloqueadas na ordem oficial
  list = [...list.filter(a => a.unlocked).sort((a, b) => (b.unlocked || 0) - (a.unlocked || 0)), ...list.filter(a => !a.unlocked)];
  const groups = d.groups && d.groups.length > 1 ? d.groups : null;
  const body = groups
    ? groups.map(gr => {
      const items = list.filter(a => a.group === gr);
      return items.length ? `<div class="ach-group">${esc(gr)}</div>${items.map(a => achItemHTML(a, d.kind)).join("")}` : "";
    }).join("")
    : list.map(a => achItemHTML(a, d.kind)).join("");
  const waiting = d.kind === "psn" && !d.unlocked
    ? `<p class="hint ach-note">${t("Os troféus são marcados quando o port grava o desbloqueio no disco. Alguns ports ainda não gravam troféus.")}</p>` : "";
  return `${achProgressHTML(d)}
    <div class="ach-tools"><div class="seg" id="ach-filter">
      <button data-achf="all" class="${ACH.filter === "all" ? "on" : ""}">${t("Todas")}</button>
      <button data-achf="on" class="${ACH.filter === "on" ? "on" : ""}">${t("Desbloqueadas")}</button>
      <button data-achf="off" class="${ACH.filter === "off" ? "on" : ""}">${t("Bloqueadas")}</button></div>
      <span class="ach-src">${t("Lista")}: ${esc(d.source || "")} · ${t("Desbloqueio")}: ${d.detect ? esc(d.detect) : `<span class="ach-nodetect" data-tip="${esc(t("Nem a Steam nem um emulador gravou conquistas deste jogo no PC. Quando algum deles gravar, o LZ Launcher passa a detectar sozinho."))}">${t("nada gravado ainda")}</span>`}</span></div>
    ${waiting}
    <div class="ach-list">${body || `<p class="hint">${t("Nada por aqui.")}</p>`}</div>`;
}

/* ---------------- Página Conquistas ---------------- */
async function renderTrophiesPage(force = false) {
  const el = $("#trophies-body");
  if (!ACH.overview || force) {
    if (!ACH.overview) el.innerHTML = `<div class="loading"><span class="spinner"></span>${t("Carregando…")}</div>`;
    try { ACH.overview = await api("achievements_overview"); } catch { return; }
  }
  const o = ACH.overview;
  const games = o.games.map(x => ({ ...x, g: gameById(x.id) })).filter(x => x.g);
  const total = games.reduce((s, x) => s + x.unlocked, 0);
  const plats = games.filter(x => x.plat).length;
  const done = games.filter(x => x.total && x.unlocked === x.total).length;
  const avg = games.length ? Math.round(games.reduce((s, x) => s + (x.total ? x.unlocked / x.total : 0), 0) / games.length * 100) : 0;
  games.sort((a, b) => (b.last || 0) - (a.last || 0) || (b.unlocked / (b.total || 1)) - (a.unlocked / (a.total || 1)));
  const kpi = (label, value, sub = "") => `<div class="kpi"><small>${label}</small><b>${value}</b>${sub ? `<span>${sub}</span>` : ""}</div>`;
  const html = `
    <div class="kpis">
      ${kpi(t("Desbloqueadas"), String(total), t("em {n} jogos", { n: games.filter(x => x.unlocked).length }))}
      ${kpi(t("Platinas"), String(plats), t("{n} jogos 100%", { n: done }))}
      ${kpi(t("Jogos com conquistas"), String(games.length))}
      ${kpi(t("Conclusão média"), avg + "%")}
    </div>
    <section class="panel">
      <header><h3>${t("Desbloqueadas recentemente")}</h3></header>
      ${o.recent.length ? `<div class="ach-list recent">${o.recent.slice(0, 15).map(r => `
        <div class="ach on" data-open="${r.game_id}">
          <div class="ach-icon">${r.icon ? `<img src="${esc(r.icon)}" alt="" loading="lazy" onerror="this.remove()">` : ""}</div>
          <div class="ach-body"><div class="ach-name">${r.kind === "psn" && r.type ? `<span class="tt ${r.type}"><i></i></span>` : ""}${esc(r.name)}</div>
            <div class="ach-desc">${esc(r.game)}</div></div>
          <div class="ach-meta">${r.rarity != null ? `<span class="ach-rar">${fmtRar(r.rarity)}</span>` : ""}<span class="ach-date">${r.ts > 1e9 ? fmtDate(r.ts) : ""}</span></div>
        </div>`).join("")}</div>` : `<p class="hint">${t("Nenhuma conquista desbloqueada ainda.")}</p>`}
    </section>
    <section class="panel">
      <header><h3>${t("Por jogo")}</h3></header>
      <div class="ach-games">${games.map(x => {
        const pct = x.total ? Math.round(x.unlocked / x.total * 100) : 0;
        return `<div class="ach-game" data-open="${x.id}">
          <div class="thumb">${x.g.cover ? `<img src="${x.g.cover}" alt="" loading="lazy" onerror="this.remove()">` : ""}</div>
          <div class="ag-main"><div class="ag-top"><span class="ag-name">${esc(x.name)}</span><span class="ag-num">${x.plat ? '<span class="tt platinum"><i></i></span>' : ""}${x.unlocked}/${x.total} · ${pct}%</span></div>
            <div class="ach-pbar"><i style="width:${pct}%"></i></div></div>
          <span class="ag-kind">${esc(achWord(x.kind, true))}</span>
        </div>`;
      }).join("")}</div>
    </section>`;
  if (el._html !== html) { el.innerHTML = html; el._html = html; }
}

/* ---------------- Modo TV: faixa de troféus ---------------- */
function tvTrophyStripHTML(g) {
  if (!g.ach) return "";
  const d = ACH.cache[g.id];
  if (!d) { loadAch(g.id).then(() => { if (state.tv) { $("#tv-info")._key = null; renderTV(); } }); return ""; }
  if (!d.list) return "";
  const items = [...d.list.filter(a => a.unlocked), ...d.list.filter(a => !a.unlocked)].slice(0, 16);
  return `<div class="tv-trophies">${items.map(a => `<span class="tv-tr ${a.unlocked ? "on" : ""}" title="${esc(a.hidden && !a.unlocked ? t("Conquista secreta") : a.name)}">${a.icon ? `<img src="${esc(a.icon)}" alt="" loading="lazy">` : ""}</span>`).join("")}</div>`;
}

/* ---------------- Eventos ---------------- */
function trophyHandleEvent(ev) {
  if (ev.type !== "trophy") return;
  delete ACH.cache[ev.game_id];
  ACH.overview = null;
  if (document.hasFocus() && !ev.test) toast(`🏆 ${ev.name} — ${ev.game}`, "ok");
  if (state.current === ev.game_id) { const g = gameById(ev.game_id); if (g) renderDetailsTrophies(g, true); }
  if (state.page === "trophies") renderTrophiesPage(true);
}

function bindTrophies() {
  document.addEventListener("click", e => {
    const f = e.target.closest("[data-achf]");
    if (f) { ACH.filter = f.dataset.achf; const g = gameById(state.current); if (g) renderDetailsTrophies(g, true); }
  });
}
