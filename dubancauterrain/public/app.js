// Du banc au terrain — site public de la prépa.
// Les données viennent de /api/state ; l'admin (connecté par mot de passe) les modifie via la même API.
(function () {
"use strict";
const START = new Date(2026, 10, 2), RESUME = new Date(2027, 0, 31), WEEKS = 13, TOTAL = 91;
const DAYN = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"], DAYK = ["L", "M", "M", "J", "V", "S", "D"];
const TYPES = { force: { label: "Force", c: "--t-cal" }, run: { label: "Course", c: "--t-run" }, foot: { label: "Ballon", c: "--t-foot" }, vit: { label: "Vitesse & appuis", c: "--t-mob" }, rest: { label: "Repos", c: "--muted" } };
const H = { "content-type": "application/json", "x-dbat": "1" };

const phaseOf = (w) => PHASES.find((p) => w >= p.from && w <= p.to);
const isRest = (w, d) => phaseOf(w).plan[d][0] === "rest";
let SESS = 0; for (let w = 1; w <= WEEKS; w++) for (let d = 0; d < 7; d++) if (!isRest(w, d)) SESS++;

let state = { checks: {}, journal: {}, profile: { name: "Valentin", handle: "dubancauterrain", bio: "" }, poll: { open: true } };
let P = state.profile, etag = null, votes = { yes: 0, no: 0 }, myVote = null, loaded = false;
let canEdit = false, preview = false, sheetAt = null, lastFocus = null, openWeeks;
let dirty = false, saving = false, pubTimer = null, status = "", draft = null;

const pad = (n) => String(n).padStart(2, "0"), fmt = (d) => pad(d.getDate()) + "." + pad(d.getMonth() + 1);
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const fmtL = (d) => d.getDate() + " " + MOIS[d.getMonth()];
const dayDate = (w, d) => { const x = new Date(START); x.setDate(x.getDate() + (w - 1) * 7 + d); return x; };
const key = (w, d) => "w" + w + "d" + d;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const now = new Date(); now.setHours(0, 0, 0, 0);
const dayIdx = Math.floor((now - START) / 864e5);
const curW = dayIdx < 0 ? 1 : Math.min(WEEKS, Math.floor(dayIdx / 7) + 1);
const curD = dayIdx >= 0 && dayIdx < TOTAL ? dayIdx % 7 : -1;
const elapsed = Math.max(0, Math.min(TOTAL, dayIdx + 1));
const handle = () => String(P.handle || "").replace(/^@/, "").trim();
const tiktokUrl = () => "https://www.tiktok.com/@" + encodeURIComponent(handle());
const editing = () => canEdit && !preview;
const MEDIA_ID = /^[a-f0-9]{32}$/;
openWeeks = new Set([curW]);

function setState(s) { state = s; state.checks = state.checks || {}; state.journal = state.journal || {}; state.profile = state.profile || {}; state.poll = state.poll || { open: true }; P = state.profile; }

// ---------- Calculs ----------
const wdOf = (i) => [Math.floor(i / 7) + 1, i % 7];
const doneAt = (i) => { const [w, d] = wdOf(i); return !!state.checks[key(w, d)]; };
const restAt = (i) => { const [w, d] = wdOf(i); return isRest(w, d); };
// "possible" = séances déjà dues : jours passés, plus aujourd'hui seulement une fois coché
function window_(from, to) { let done = 0, pos = 0; for (let i = Math.max(0, from); i <= Math.min(to, TOTAL - 1); i++) { if (restAt(i)) continue; const on = doneAt(i); if (i < dayIdx || on) { pos++; if (on) done++; } } return { done, pos }; }
function counts() {
  let done = 0; const by = {}; Object.keys(TYPES).forEach((t) => (by[t] = [0, 0]));
  for (let w = 1; w <= WEEKS; w++) { const p = phaseOf(w); for (let d = 0; d < 7; d++) { const t = p.plan[d][0]; if (t === "rest") continue; const on = !!state.checks[key(w, d)]; by[t][1]++; if (on) { done++; by[t][0]++; } } }
  let s = 0, i = Math.min(dayIdx, TOTAL - 1);
  while (i >= 0 && (restAt(i) || (i === dayIdx && !doneAt(i)))) i--;
  while (i >= 0) { if (restAt(i)) { i--; continue; } if (!doneAt(i)) break; s++; i--; }
  const all = window_(0, dayIdx);
  return { done, past: all.pos, by, streak: s, reg: all.pos ? Math.round((all.done / all.pos) * 100) : 0 };
}
function pronostic() {
  const c = counts(), rec = window_(dayIdx - 13, dayIdx), all = window_(0, dayIdx);
  if (!all.pos) return null;
  const recent = rec.pos ? rec.done / rec.pos : 0, overall = all.done / all.pos, streak = Math.min(1, c.streak / 12);
  let score = 100 * (0.55 * recent + 0.3 * overall + 0.15 * streak), wNote = null;
  const goal = parseFloat(String(P.goalWeight || "").replace(",", "."));
  const ws = []; for (let w = 1; w <= WEEKS; w++) { const v = parseFloat(String((state.journal[w] || {}).weight || "").replace(",", ".")); if (!isNaN(v)) ws.push([w, v]); }
  if (!isNaN(goal) && ws.length >= 2) {
    const [w0, v0] = ws[0], [w1, v1] = ws[ws.length - 1], left = Math.max(1, WEEKS - w1);
    const need = (v1 - goal) / left, pace = (v0 - v1) / Math.max(1, w1 - w0);
    const f = (x) => x.toFixed(1).replace(".", ",");
    if (v1 <= goal) { score += 5; wNote = ["Poids", "objectif atteint", 1]; }
    else if (pace >= need * 0.8) { score += 3; wNote = ["Poids", f(pace) + " kg/sem., il en faut " + f(need), 1]; }
    else { score -= 6; wNote = ["Poids", f(pace) + " kg/sem., il en faut " + f(need), Math.max(0, pace / need)]; }
  }
  score = Math.round(Math.max(3, Math.min(97, score)));
  const v = score >= 75 ? ["Il va y arriver", "--t-cal"] : score >= 55 ? ["En bonne voie", "--t-mob"] : score >= 35 ? ["À surveiller", "--bib"] : ["Ça va être chaud", "--t-box"];
  const crit = [["Régularité sur 14 jours", rec.done + "/" + rec.pos + " séances", recent], ["Régularité depuis le début", all.done + "/" + all.pos + " séances", overall], ["Série en cours", c.streak + " séance" + (c.streak > 1 ? "s" : "") + " d'affilée", streak]];
  if (wNote) crit.push(wNote);
  return { score, verdict: v[0], color: v[1], crit, early: all.pos < 6 };
}

const TT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.6 3c.4 2.2 1.8 3.7 4 4v3.1c-1.5 0-2.9-.4-4-1.2v6.3c0 3.4-2.6 5.8-5.8 5.8S5 18.6 5 15.3s2.6-5.8 5.8-5.8c.3 0 .6 0 .9.1v3.2a2.7 2.7 0 1 0 1.8 2.5V3h3.1z"/></svg>';
const PITCH = '<svg class="pitch" viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g fill="none" stroke="#EAF0F7" stroke-width="1.2"><rect x="10" y="10" width="380" height="240"/><line x1="200" y1="10" x2="200" y2="250"/><circle cx="200" cy="130" r="38"/><circle cx="200" cy="130" r="2" fill="#EAF0F7"/><rect x="10" y="70" width="56" height="120"/><rect x="334" y="70" width="56" height="120"/><rect x="10" y="102" width="20" height="56"/><rect x="370" y="102" width="20" height="56"/></g></svg>';

// ---------- Structure ----------
function shell() {
  document.getElementById("app").innerHTML = `
  <div id="ownbar"></div>
  <header class="hero">${PITCH}<div class="wrap" id="hero"></div></header>
  <main class="wrap" id="main">
    <section class="blk" aria-labelledby="t-today"><div class="sec-head"><div><span class="eyebrow">Séance du jour</span><h2 id="t-today">Aujourd'hui</h2></div></div><div id="today"></div></section>
    <section class="blk" aria-labelledby="t-pron"><div class="sec-head"><div><span class="eyebrow">Le pronostic</span><h2 id="t-pron">Va-t-il y arriver ?</h2></div></div><div id="pron"></div><div id="public"></div></section>
    <section class="blk" aria-labelledby="t-board"><div class="sec-head"><div><span class="eyebrow">91 jours · ${SESS} séances · 13 jours de repos</span><h2 id="t-board">Le tableau</h2><p>Chaque case est un jour de la prépa. Pleine : séance faite. Hachurée : séance manquée. Pointillés : jour de repos. Touche une case pour voir le programme.</p></div></div>
      <div id="stats"></div><div class="board-wrap"><div class="board" id="board"></div></div><div class="legend" id="legend"></div></section>
    <section class="blk" aria-labelledby="t-plan"><div class="sec-head"><div><span class="eyebrow">13 semaines · 3 blocs</span><h2 id="t-plan">Le plan</h2></div></div><div class="phases" id="phases"></div></section>
    <section class="blk" aria-labelledby="t-journal"><div class="sec-head"><div><span class="eyebrow">Semaine après semaine</span><h2 id="t-journal">Le journal</h2></div></div><div id="jform"></div><div class="entries" id="entries"></div></section>
    <section class="blk" id="weightSec" aria-labelledby="t-weight" hidden><div class="sec-head"><div><span class="eyebrow">Pesée du lundi</span><h2 id="t-weight">Le poids</h2></div></div><div class="chart" id="chart"></div></section>
    <section class="blk" aria-labelledby="t-weeks"><div class="sec-head"><div><span class="eyebrow">Tout le programme</span><h2 id="t-weeks">Les séances</h2><p>Ouvre une séance pour voir l'échauffement, les exercices, les séries et les conseils.</p></div></div><div class="weeks" id="weeks"></div></section>
    <section class="blk" id="settingsSec" hidden aria-labelledby="t-set"><div class="sec-head"><div><span class="eyebrow">Visible par toi seul</span><h2 id="t-set">Réglages du site</h2></div></div><div id="settings"></div></section>
  </main>
  <footer><div class="wrap" id="foot"></div></footer>
  <div class="ov" id="ov" hidden><div class="sheet" id="sheet" role="dialog" aria-modal="true" aria-labelledby="shT"></div></div>
  <div class="lb" id="lb" hidden role="dialog" aria-modal="true" aria-label="Photo"><button class="x" data-lbclose aria-label="Fermer">×</button><img id="lbimg" alt=""></div>`;
}

function renderOwnbar() {
  const el = document.getElementById("ownbar");
  document.body.classList.toggle("owner", canEdit);
  if (!canEdit) { el.className = ""; el.innerHTML = ""; return; }
  el.className = "ownbar";
  el.innerHTML = `<div class="wrap"><div><b>${preview ? "Aperçu visiteur" : "Mode édition"}</b> <span id="pubst">${esc(status || "Ce que tu coches est publié sur le site")}</span></div>
   <div class="acts">${dirty ? `<button class="solid" data-act="pubnow">Publier maintenant</button>` : ""}<button data-act="preview">${preview ? "Revenir à l'édition" : "Voir comme un visiteur"}</button><button data-act="logout">Déconnexion</button></div></div>`;
}

function renderHero() {
  const c = counts(), left = Math.max(0, Math.ceil((RESUME - now) / 864e5));
  const pctT = Math.round((elapsed / TOTAL) * 100), pctD = Math.round((c.done / SESS) * 100);
  const h = handle();
  document.getElementById("hero").innerHTML = `
   <div><span class="eyebrow">Opération 2e tour · ${fmtL(START)} → ${fmtL(RESUME)}</span>
     <h1>Du banc <em>au terrain</em></h1>
     <p class="who"><b>${esc(P.name || "Valentin")}</b> — ${esc(P.bio || "")}</p>
     ${h ? `<a class="cta" href="${tiktokUrl()}" target="_blank" rel="noopener">${TT}Suivre @${esc(h)} sur TikTok</a>` : editing() ? `<button class="cta hint" data-act="gosettings">${TT}Ajoute ton pseudo TikTok dans les réglages</button>` : ""}
   </div>
   <div class="clock"><span class="eyebrow">Avant la reprise</span>
     <div class="num"><small>J-</small>${left}</div>
     <div class="lbl">${dayIdx < 0 ? "Début le " + fmtL(START) : dayIdx >= TOTAL ? "Prépa terminée" : "Jour " + (dayIdx + 1) + " sur " + TOTAL + " · semaine " + curW}</div>
     <div class="track"><div class="bar"><i style="width:${pctD}%"></i><u style="left:${pctT}%"></u></div>
       <div class="row"><span>${c.done} séances faites</span><span>${pctD} %</span></div></div>
   </div>`;
}

function renderToday() {
  const el = document.getElementById("today");
  if (curD < 0) { el.innerHTML = `<div class="empty">${dayIdx < 0 ? "La prépa commence le " + fmtL(START) + "." : "La prépa est terminée. Place au deuxième tour."}</div>`; return; }
  const p = phaseOf(curW), [t, title, desc] = p.plan[curD], k = key(curW, curD), on = !!state.checks[k];
  if (t === "rest") {
    el.innerHTML = `<div class="today rest" style="--c:var(--muted)"><div class="stamp" aria-hidden="true">R</div>
    <div><span class="eyebrow">${DAYN[curD]} ${fmtL(now)} · jour off</span><h3>Repos</h3><p>Récupération complète avant la nouvelle semaine.</p></div>
    <div class="acts"><button class="btn ghost" data-open="${curW}-${curD}">Voir le programme du jour</button></div></div>`;
    return;
  }
  el.innerHTML = `<div class="today ${on ? "done" : ""}" style="--c:var(${TYPES[t].c})">
    <div class="stamp" aria-hidden="true">${on ? "✓" : DAYK[curD]}</div>
    <div><span class="eyebrow">${DAYN[curD]} ${fmtL(now)} · ${TYPES[t].label} · ${on ? "faite" : "à faire"}</span><h3>${esc(title)}</h3><p>${esc(desc)}</p></div>
    <div class="acts"><button class="btn ghost" data-open="${curW}-${curD}">Voir la séance</button>
    ${editing() ? `<button class="btn ${on ? "on" : "hot"}" data-k="${k}">${on ? "Faite ✓" : "Marquer comme faite"}</button>` : ""}</div></div>`;
}

function renderPron() {
  const el = document.getElementById("pron"), r = pronostic();
  if (!r) { el.innerHTML = `<div class="empty">Le pronostic apparaît dès la première séance cochée.</div>`; return; }
  const R = 110, cx = 130, cy = 130, a = Math.PI * (1 - r.score / 100), px = cx + R * Math.cos(a), py = cy - R * Math.sin(a);
  const arc = (x, y) => `M${cx - R} ${cy} A${R} ${R} 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}`;
  const ticks = [0, 25, 50, 75, 100].map((v) => { const b = Math.PI * (1 - v / 100); return `<line x1="${(cx + (R + 12) * Math.cos(b)).toFixed(1)}" y1="${(cy - (R + 12) * Math.sin(b)).toFixed(1)}" x2="${(cx + (R + 20) * Math.cos(b)).toFixed(1)}" y2="${(cy - (R + 20) * Math.sin(b)).toFixed(1)}" stroke="var(--muted)" stroke-width="1.5"/>`; }).join("");
  el.innerHTML = `<div class="pron" style="--vc:var(${r.color})">
    <div class="gauge"><svg viewBox="0 0 260 150" aria-hidden="true">${ticks}
      <path d="${arc(cx + R, cy)}" fill="none" stroke="var(--line)" stroke-width="16"/>
      <path d="${arc(px, py)}" fill="none" stroke="var(--vc)" stroke-width="16"/>
      <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="9" fill="var(--night)" stroke="var(--vc)" stroke-width="4"/></svg>
      <div class="val"><b>${r.score}<small style="font-size:.4em"> %</small></b><span>chances d'être prêt</span></div></div>
    <div><div class="verdict" role="status">${r.verdict}</div>
      <div class="crit">${r.crit.map(([l, v, x]) => `<div class="r"><span>${l}</span><em>${v}</em><i><u style="width:${Math.round(x * 100)}%"></u></i></div>`).join("")}</div>
      <small class="how">${r.early ? "Pronostic provisoire : il se précise au fil des séances. " : ""}Calcul automatique, mis à jour à chaque séance cochée : régularité des 14 derniers jours (55 %), régularité depuis le début (30 %), série en cours (15 %)${r.crit.length > 3 ? ", ajusté selon la courbe de poids" : ""}.</small></div></div>`;
}

function renderPublic() {
  const el = document.getElementById("public");
  const tot = votes.yes + votes.no, yp = tot ? Math.round((votes.yes / tot) * 100) : 0, r = pronostic();
  const open = state.poll.open !== false;
  let compare = "";
  if (tot && r) { const gap = yp - r.score; compare = Math.abs(gap) <= 10 ? "Le public et le pronostic sont d'accord." : gap > 0 ? `Le public y croit plus que le pronostic (${gap} points d'écart).` : `Le pronostic y croit plus que le public (${-gap} points d'écart).`; }
  el.innerHTML = `<div class="public">
    <div><span class="eyebrow">Le verdict du public · ${tot} vote${tot > 1 ? "s" : ""}</span><h3>Et toi, tu y crois ?</h3><p>${open ? (myVote ? "Ton vote est enregistré. Tu peux changer d'avis à tout moment." : "Un vote par personne. Tu pourras changer d'avis plus tard.") : "Le vote est fermé."}</p></div>
    <div class="votes" role="group" aria-label="Voter">
      <button class="vbtn" style="--c:var(--t-cal)" data-vote="yes" aria-pressed="${myVote === "yes"}" ${open && loaded ? "" : "disabled"}>Oui</button>
      <button class="vbtn" style="--c:var(--t-box)" data-vote="no" aria-pressed="${myVote === "no"}" ${open && loaded ? "" : "disabled"}>Non</button></div>
    <div class="split">${tot ? `<div class="track2" aria-hidden="true"><i style="width:${yp}%;background:var(--t-cal)"></i><i style="width:${100 - yp}%;background:var(--t-box)"></i></div>
      <div class="labels"><span>Oui ${yp} % (${votes.yes})</span><span>Non ${100 - yp} % (${votes.no})</span></div>` : `<div class="labels"><span>Pas encore de vote : sois le premier.</span></div>`}</div>
    ${compare ? `<div class="compare">${compare}</div>` : ""}</div>`;
}

function renderBoard() {
  const c = counts();
  document.getElementById("stats").innerHTML = `<div class="stats">
    <div class="stat"><span class="eyebrow">Séances faites</span><b>${c.done}<small> / ${SESS}</small></b></div>
    <div class="stat"><span class="eyebrow">Régularité</span><b>${c.reg}<small> %</small></b></div>
    <div class="stat"><span class="eyebrow">Série en cours</span><b>${c.streak}<small> j</small></b></div>
    <div class="stat"><span class="eyebrow">Semaine</span><b>${curW}<small> / ${WEEKS}</small></b></div></div>`;
  let h = `<span></span>`;
  for (let w = 1; w <= WEEKS; w++) h += `<span class="wk ${w === curW ? "cur" : ""}">S${w}</span>`;
  for (let d = 0; d < 7; d++) {
    h += `<span class="dl">${DAYK[d]}</span>`;
    for (let w = 1; w <= WEEKS; w++) {
      const t = phaseOf(w).plan[d][0], i = (w - 1) * 7 + d, on = !!state.checks[key(w, d)];
      const cls = t === "rest" ? "rest" + (i > dayIdx ? " future" : "") : on ? "done" : i < dayIdx ? "miss" : i > dayIdx ? "future" : "";
      h += `<button class="cell ${cls} ${i === dayIdx ? "td" : ""}" style="--c:var(${TYPES[t].c})" data-open="${w}-${d}" aria-label="S${w} ${DAYN[d]} ${fmt(dayDate(w, d))}, ${TYPES[t].label}${on ? ", faite" : ""}"></button>`;
    }
  }
  document.getElementById("board").innerHTML = h;
  document.getElementById("legend").innerHTML = Object.entries(TYPES).filter(([t]) => t !== "rest").map(([t, v]) => `<span><i class="sw" style="background:var(${v.c});border-color:var(${v.c})"></i>${v.label} ${c.by[t][0]}/${c.by[t][1]}</span>`).join("") +
    `<span><i class="sw" style="background:repeating-linear-gradient(135deg,transparent 0 3px,rgba(142,156,178,.4) 3px 4px)"></i>Manquée</span><span><i class="sw" style="border-style:dashed"></i>Repos</span>`;
}

function renderPhases() {
  document.getElementById("phases").innerHTML = PHASES.map((p, ix) => {
    let pd = 0, pt = 0; for (let w = p.from; w <= p.to; w++) for (let d = 0; d < 7; d++) { if (isRest(w, d)) continue; pt++; if (state.checks[key(w, d)]) pd++; }
    const now_ = curW >= p.from && curW <= p.to;
    return `<div class="phase ${now_ ? "now" : ""}"><span class="n">${ix + 1}</span>${now_ ? `<span class="now-tag">En cours</span>` : ""}<h3>${p.name}</h3>
      <p>${p.goal}</p><span class="meta">S${p.from}–S${p.to} · ${fmtL(dayDate(p.from, 0))} → ${fmtL(dayDate(p.to, 6))} · ${pd}/${pt}</span>
      <div class="pbar"><i style="width:${Math.round((pd / pt) * 100)}%"></i></div></div>`;
  }).join("");
}

function mediaGrid(list, editable) {
  const items = list.filter((m) => m && (MEDIA_ID.test(m.id) || m.pending));
  if (!items.length) return "";
  return `<div class="media">${items.map((m, ix) => {
    if (m.pending) return `<div class="m wait">Envoi…</div>`;
    const src = "/media/" + m.id;
    const inner = m.kind === "video"
      ? `<video src="${src}" controls playsinline preload="metadata"></video>`
      : `<button class="zoom" data-zoom="${src}" aria-label="Agrandir la photo"><img src="${src}" alt="Photo de la semaine" loading="lazy"></button>`;
    return `<div class="m">${inner}${editable ? `<button class="rm" data-rm="${ix}" aria-label="Retirer ce média">×</button>` : ""}</div>`;
  }).join("")}</div>`;
}

function renderEntries() {
  const ws = Object.keys(state.journal).map(Number).filter((w) => { const j = state.journal[w]; return j && (j.note || j.weight || j.video || (j.media && j.media.length)); }).sort((a, b) => b - a);
  const el = document.getElementById("entries");
  if (!ws.length) { el.innerHTML = `<div class="empty">Le premier bilan de semaine arrive bientôt.</div>`; return; }
  el.innerHTML = ws.map((w) => {
    const j = state.journal[w]; let wd = 0, wt = 0; for (let d = 0; d < 7; d++) { if (isRest(w, d)) continue; wt++; if (state.checks[key(w, d)]) wd++; }
    const v = String(j.video || ""), vOk = /^https:\/\/(www\.|vm\.)?tiktok\.com\//.test(v);
    return `<article class="entry"><div class="wkn">S${w}<small>${fmt(dayDate(w, 0))}–${fmt(dayDate(w, 6))}</small></div>
      <div style="min-width:0">${j.note ? `<p>${esc(j.note)}</p>` : ""}${mediaGrid(j.media || [], false)}<div class="foot"><span>${wd}/${wt} séances</span>${j.weight ? `<span>${esc(j.weight)} kg</span>` : ""}${vOk ? `<a href="${esc(v)}" target="_blank" rel="noopener">Voir la vidéo de la semaine sur TikTok →</a>` : ""}</div></div></article>`;
  }).join("");
}

function renderJForm() {
  const el = document.getElementById("jform");
  if (!editing()) { el.innerHTML = ""; return; }
  const sel = +(el.dataset.w || curW), j = state.journal[sel] || {};
  el.dataset.w = sel;
  if (!draft || draft.w !== sel) draft = { w: sel, media: (j.media || []).map((m) => ({ ...m })) };
  el.innerHTML = `<form class="form" id="jf"><h3>Écrire le bilan</h3>
    <div class="drop"><label for="jfile" style="flex:1 1 220px">Photos et vidéos de la semaine (4,5 Mo max par fichier)<input id="jfile" type="file" accept="image/*,video/mp4,video/quicktime,video/webm" multiple></label>
      <span class="muted" id="jmsg">Les photos sont réduites automatiquement avant l'envoi.</span></div>
    <div id="jmedia">${mediaGrid(draft.media, true)}</div>
    <div class="fields"><label for="jw">Semaine<select id="jw">${Array.from({ length: WEEKS }, (_, i) => `<option value="${i + 1}" ${i + 1 === sel ? "selected" : ""}>S${i + 1} · ${fmt(dayDate(i + 1, 0))}</option>`).join("")}</select></label>
    <label for="jkg">Poids du lundi (kg, facultatif)<input id="jkg" inputmode="decimal" value="${esc(j.weight || "")}" placeholder="ex. 86,4"></label>
    <label for="jv">Lien TikTok de la semaine (facultatif)<input id="jv" type="url" value="${esc(j.video || "")}" placeholder="https://www.tiktok.com/@…"></label></div>
    <label for="jn">Ce qui s'est passé cette semaine<textarea id="jn" placeholder="Séances réussies, difficultés, sensations, objectif de la semaine prochaine…">${esc(j.note || "")}</textarea></label>
    <div class="row"><button class="btn hot" type="submit">Publier le bilan</button><span class="muted">Le poids n'apparaît sur le site que si tu le remplis.</span></div></form>`;
}

function renderChart() {
  const pts = []; for (let w = 1; w <= WEEKS; w++) { const v = parseFloat(String((state.journal[w] || {}).weight || "").replace(",", ".")); if (!isNaN(v)) pts.push([w, v]); }
  const sec = document.getElementById("weightSec");
  if (!pts.length) { sec.hidden = true; return; }
  sec.hidden = false;
  const goal = parseFloat(String(P.goalWeight || "").replace(",", "."));
  const vals = pts.map((p) => p[1]).concat(isNaN(goal) ? [] : [goal]);
  const lo = Math.floor(Math.min(...vals) - 1), hi = Math.ceil(Math.max(...vals) + 1);
  const W = 620, Hh = 230, L = 44, R = 16, T = 16, B = 32;
  const x = (w) => L + ((w - 1) * (W - L - R)) / (WEEKS - 1), y = (v) => T + ((hi - v) * (Hh - T - B)) / (hi - lo);
  let g = ""; const step = Math.max(1, Math.round((hi - lo) / 4));
  for (let v = lo; v <= hi; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" fill="var(--muted)" font-size="11" font-family="IBM Plex Mono,monospace">${v}</text>`;
  for (let w = 1; w <= WEEKS; w += 2) g += `<text x="${x(w)}" y="${Hh - 10}" text-anchor="middle" fill="var(--muted)" font-size="11" font-family="IBM Plex Mono,monospace">S${w}</text>`;
  if (!isNaN(goal)) g += `<line x1="${L}" x2="${W - R}" y1="${y(goal)}" y2="${y(goal)}" stroke="var(--t-cal)" stroke-dasharray="5 5"/><text x="${W - R}" y="${y(goal) - 6}" text-anchor="end" fill="var(--t-cal)" font-size="11" font-family="IBM Plex Mono,monospace">objectif ${goal} kg</text>`;
  const path = pts.map((p, i) => (i ? "L" : "M") + x(p[0]) + " " + y(p[1])).join(" ");
  const area = pts.length > 1 ? `<path d="${path} L${x(pts[pts.length - 1][0])} ${Hh - B} L${x(pts[0][0])} ${Hh - B} Z" fill="var(--bib)" opacity=".12"/>` : "";
  const last = pts[pts.length - 1];
  document.getElementById("chart").innerHTML = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Poids par semaine">${g}${area}<path d="${path}" fill="none" stroke="var(--bib)" stroke-width="2.5"/>${pts.map((p) => `<circle cx="${x(p[0])}" cy="${y(p[1])}" r="4" fill="var(--bib)"/>`).join("")}<text x="${x(last[0])}" y="${y(last[1]) - 10}" text-anchor="middle" fill="var(--ink)" font-size="13" font-weight="600" font-family="IBM Plex Mono,monospace">${last[1]} kg</text></svg>`;
}

function renderWeeks() {
  const el = document.getElementById("weeks"); let h = "";
  for (let w = 1; w <= WEEKS; w++) {
    const p = phaseOf(w); let wd = 0;
    const dots = p.plan.map(([t], d) => { if (t === "rest") return `<i class="rest"></i>`; const on = !!state.checks[key(w, d)]; if (on) wd++; return `<i class="${on ? "on" : ""}" style="--c:var(${TYPES[t].c})"></i>`; }).join("");
    const op = openWeeks.has(w);
    h += `<div class="wkr ${w === curW ? "cur" : ""}"><button class="wkh" data-w="${w}" aria-expanded="${op}"><span class="n">S${w}</span>
      <span><span class="dt">${fmt(dayDate(w, 0))} → ${fmt(dayDate(w, 6))} · ${p.name}</span><span class="dots">${dots}</span></span><span class="pc">${wd}/6</span></button>`;
    if (op) {
      h += `<div class="wkb">${NOTES[w] ? `<p class="note">${NOTES[w]}</p>` : ""}` + p.plan.map(([t, title, desc], d) => {
        const k = key(w, d), on = !!state.checks[k];
        const box = t === "rest" ? `<span class="cb none" aria-hidden="true">—</span>`
          : editing() ? `<button class="cb ${on ? "on" : ""}" style="--c:var(${TYPES[t].c})" data-k="${k}" aria-pressed="${on}" aria-label="Séance faite : ${esc(title)}"></button>`
          : `<span class="cb ro ${on ? "on" : ""}" style="--c:var(${TYPES[t].c})" aria-label="${on ? "Faite" : "Pas encore faite"}"></span>`;
        return `<div class="it">${box}<button class="open" data-open="${w}-${d}"><span class="when">${DAYN[d]} ${fmt(dayDate(w, d))} · ${TYPES[t].label}</span><b>${esc(title)}</b><span>${esc(desc)}</span></button></div>`;
      }).join("") + `</div>`;
    }
    h += `</div>`;
  }
  el.innerHTML = h;
}

function renderSettings() {
  const sec = document.getElementById("settingsSec");
  sec.hidden = !editing(); if (!editing()) return;
  const tot = votes.yes + votes.no;
  document.getElementById("settings").innerHTML = `<form class="form" id="sf">
    <div class="fields"><label for="sname">Nom affiché<input id="sname" value="${esc(P.name || "")}"></label>
    <label for="shandle">Pseudo TikTok<input id="shandle" value="${esc(P.handle || "")}" placeholder="@ton.pseudo"></label>
    <label for="sgoal">Objectif de poids (kg, facultatif)<input id="sgoal" inputmode="decimal" value="${esc(P.goalWeight || "")}"></label></div>
    <label for="sbio">Ta présentation<textarea id="sbio">${esc(P.bio || "")}</textarea></label>
    <label for="spoll" style="flex-direction:row;align-items:center;gap:8px"><input id="spoll" type="checkbox" style="width:auto" ${state.poll.open !== false ? "checked" : ""}> Vote du public ouvert (${tot} vote${tot > 1 ? "s" : ""} pour l'instant)</label>
    <div class="row"><button class="btn hot" type="submit">Publier les réglages</button></div></form>
  <form class="form" id="imf" style="margin-top:12px"><h3>Reprendre les données de l'ancien site</h3>
    <label for="imtxt">Colle ici les données copiées depuis l'ancien site (coches, journal, réglages)<textarea id="imtxt" placeholder='{"checks":{…},"journal":{…},"profile":{…}}'></textarea></label>
    <div class="row"><button class="btn ghost" type="submit">Importer et publier</button><span class="muted" id="immsg">Remplace les coches, le journal et les réglages actuels. Les photos de l'ancien site ne sont pas reprises.</span></div></form>`;
}

function renderFoot() {
  const h = handle();
  document.getElementById("foot").innerHTML = `<span>${esc(P.name || "Valentin")} · Du banc au terrain</span>
    <span style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">${h ? `<a href="${tiktokUrl()}" target="_blank" rel="noopener">@${esc(h)} sur TikTok</a>` : ""}</span>`;
}

function renderSheet() {
  const ov = document.getElementById("ov"), sh = document.getElementById("sheet");
  if (!sheetAt) { ov.hidden = true; return; }
  if (sheetAt === "login") {
    sh.style.setProperty("--c", "var(--bib)");
    sh.innerHTML = `<div class="sh-top"><div><span class="eyebrow">Espace admin</span><h3 id="shT">Connexion</h3></div><button class="x" data-close aria-label="Fermer">×</button></div>
      <form class="login" id="lf"><label for="lpw">Mot de passe<input id="lpw" type="password" autocomplete="current-password" required></label>
      <div class="err" id="lerr" role="alert"></div><button class="btn hot" type="submit">Se connecter</button></form>`;
    if (ov.hidden) { ov.hidden = false; document.getElementById("lpw").focus(); }
    return;
  }
  const [w, d] = sheetAt, p = phaseOf(w), [t, title, , det] = p.plan[d], k = key(w, d), on = !!state.checks[k];
  sh.style.setProperty("--c", `var(${TYPES[t].c})`);
  sh.innerHTML = `<div class="sh-top"><div><span class="eyebrow">${DAYN[d]} ${fmtL(dayDate(w, d))} · S${w} · ${p.name}</span><h3 id="shT">${esc(title)}</h3></div><button class="x" data-close aria-label="Fermer">×</button></div>
   <div class="chips"><span class="chip t">${TYPES[t].label}</span><span class="chip">${det.dur}</span>${on ? `<span class="chip t">Faite ✓</span>` : ""}</div>
   ${NOTES[w] && t !== "rest" ? `<p class="note" style="margin:0">${NOTES[w]}</p>` : ""}
   ${det.warm.length ? `<div class="ssec"><h4>Échauffement</h4><ul>${det.warm.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
   <div class="ssec"><h4>${t === "rest" ? "Programme" : "Séance"}</h4>${det.blocks.map((b) => `<div class="bk"><h5>${esc(b.h)}</h5><div class="ex">${b.items.map(([e, q]) => `<div>${esc(e)}</div><div class="dose">${esc(q)}</div>`).join("")}</div></div>`).join("")}</div>
   <div class="ssec"><h4>${t === "rest" ? "Récupération" : "Retour au calme"}</h4><p style="margin:0">${esc(det.cool)}</p></div>
   <div class="tip"><b>Conseil · </b>${esc(det.tip)}</div>
   ${editing() && t !== "rest" ? `<button class="btn ${on ? "on" : "hot"}" data-k="${k}">${on ? "Faite ✓ (annuler)" : "Marquer comme faite"}</button>` : ""}
   <div class="shnav"><button class="btn ghost" data-step="-1" ${w > 1 || d > 0 ? "" : "disabled"}>← Jour précédent</button><button class="btn ghost" data-step="1" ${w < WEEKS || d < 6 ? "" : "disabled"}>Jour suivant →</button></div>`;
  if (ov.hidden) { ov.hidden = false; sh.scrollTop = 0; sh.querySelector(".x").focus(); }
}

function renderProgress() { renderOwnbar(); renderHero(); renderToday(); renderPron(); renderPublic(); renderBoard(); renderPhases(); renderWeeks(); renderEntries(); renderChart(); renderFoot(); if (sheetAt) renderSheet(); }
function renderAll() { renderProgress(); renderJForm(); renderSettings(); }

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: "same-origin", ...opts });
  let body = null; try { body = await res.json(); } catch {}
  if (!res.ok) { const e = new Error((body && body.error) || "Erreur " + res.status); e.status = res.status; throw e; }
  return body;
}
async function load() {
  try {
    const r = await api("/api/state");
    setState(r.state); etag = r.etag; votes = r.votes || votes; loaded = true;
    document.getElementById("main").classList.remove("loading");
  } catch (e) { setStatus("Impossible de charger les données"); }
  try { myVote = (await api("/api/vote")).mine; } catch {}
  try { const v = localStorage.getItem("dbat-vote"); if (!myVote && (v === "yes" || v === "no")) myVote = v; } catch {}
  renderAll();
}
async function checkAdmin() {
  try { if ((await api("/api/me")).admin) { canEdit = true; await reloadFresh(); } } catch {}
}
async function reloadFresh() { // l'admin relit la version exacte, hors cache
  try { const r = await api("/api/state", { cache: "no-store" }); setState(r.state); etag = r.etag; votes = r.votes || votes; } catch {}
  draft = null; renderAll();
}

function setStatus(t) { status = t; const s = document.getElementById("pubst"); if (s) s.textContent = t; }
function schedule() { dirty = true; clearTimeout(pubTimer); setStatus("Publication dans quelques secondes…"); renderOwnbar(); pubTimer = setTimeout(save, 1500); }
async function save() {
  clearTimeout(pubTimer);
  if (saving) { pubTimer = setTimeout(save, 800); return false; }
  saving = true; setStatus("Publication…");
  try {
    const r = await api("/api/state", { method: "PUT", headers: H, body: JSON.stringify({ state, etag }) });
    etag = r.etag; setState(r.state); dirty = false; setStatus("Publié ✓"); renderOwnbar(); return true;
  } catch (e) {
    if (e.status === 401) { canEdit = false; setStatus(""); renderAll(); if (loginKey()) openSheet("login"); }
    else if (e.status === 409) { setStatus("Modifié ailleurs : rechargement des données…"); await reloadFresh(); }
    else { setStatus("Pas publié : " + e.message); renderOwnbar(); }
    return false;
  } finally { saving = false; }
}

// ---------- Interactions ----------
function toggle(k) { if (!editing()) return; if (state.checks[k]) delete state.checks[k]; else state.checks[k] = true; renderProgress(); schedule(); }
function openSheet(x, y) { lastFocus = document.activeElement; sheetAt = x === "login" ? "login" : [x, y]; document.getElementById("ov").hidden = true; renderSheet(); }
function closeSheet() { sheetAt = null; renderSheet(); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
function step(n) { let i = (sheetAt[0] - 1) * 7 + sheetAt[1] + n; i = Math.max(0, Math.min(TOTAL - 1, i)); sheetAt = [Math.floor(i / 7) + 1, i % 7]; renderSheet(); document.getElementById("sheet").scrollTop = 0; }

async function vote(v) {
  if (!loaded) return;
  const prev = myVote; myVote = v; renderPublic();
  try {
    const r = await api("/api/vote", { method: "POST", headers: H, body: JSON.stringify({ v }) });
    votes = r.votes; myVote = r.mine; try { localStorage.setItem("dbat-vote", r.mine); } catch {}
  } catch (e) { myVote = prev; }
  renderPublic();
}

document.addEventListener("click", (e) => {
  const z = e.target.closest("[data-zoom]"); if (z) { const lb = document.getElementById("lb"); document.getElementById("lbimg").src = z.dataset.zoom; lb.hidden = false; lb.querySelector(".x").focus(); return; }
  if (e.target.closest("[data-lbclose]") || e.target.id === "lb") { document.getElementById("lb").hidden = true; return; }
  const rm = e.target.closest("[data-rm]"); if (rm && draft) { const live = draft.media.filter((m) => m && (MEDIA_ID.test(m.id) || m.pending)); const item = live[+rm.dataset.rm]; if (item && !item.pending) { draft.media.splice(draft.media.indexOf(item), 1); refreshDraft(); msg("Média retiré. Publie le bilan pour enregistrer."); } return; }
  const vb = e.target.closest("[data-vote]"); if (vb) return vote(vb.dataset.vote);
  if (e.target.id === "ov") return closeSheet();
  if (e.target.closest("[data-close]")) return closeSheet();
  const s = e.target.closest("[data-step]"); if (s) return step(+s.dataset.step);
  const o = e.target.closest("[data-open]"); if (o) { const [w, d] = o.dataset.open.split("-").map(Number); return openSheet(w, d); }
  const b = e.target.closest("[data-k]"); if (b) return toggle(b.dataset.k);
  const h = e.target.closest("[data-w]"); if (h) { const w = +h.dataset.w; openWeeks.has(w) ? openWeeks.delete(w) : openWeeks.add(w); return renderWeeks(); }
  const a = e.target.closest("[data-act]"); if (a) {
    const act = a.dataset.act;
    if (act === "preview") { preview = !preview; sheetAt = null; renderSheet(); renderAll(); }
    else if (act === "pubnow") save();
    else if (act === "gosettings") document.getElementById("settingsSec").scrollIntoView({ behavior: "smooth" });
    else if (act === "login") openSheet("login");
    else if (act === "logout") { api("/api/logout", { method: "POST", headers: H }).catch(() => {}); canEdit = false; preview = false; renderAll(); }
  }
});
document.addEventListener("keydown", (e) => { if (e.key !== "Escape") return; const lb = document.getElementById("lb"); if (!lb.hidden) { lb.hidden = true; return; } if (sheetAt) closeSheet(); });
document.addEventListener("change", (e) => {
  if (e.target.id === "jw") { document.getElementById("jform").dataset.w = e.target.value; renderJForm(); }
  else if (e.target.id === "jfile") { const files = [...e.target.files]; e.target.value = ""; files.forEach(uploadOne); }
});
document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = e.target.id;
  if (id === "lf") {
    const err = document.getElementById("lerr"); err.textContent = "";
    try { await api("/api/login", { method: "POST", headers: H, body: JSON.stringify({ key: loginKey(), password: document.getElementById("lpw").value }) }); sheetAt = null; renderSheet(); canEdit = true; await reloadFresh(); }
    catch (x) { err.textContent = x.status === 401 ? "Mot de passe incorrect." : x.status === 429 ? "Trop d'essais : réessaie dans 15 minutes." : x.status === 404 ? "Ce lien de connexion n'est pas valide." : "Connexion impossible pour l'instant, réessaie."; }
    return;
  }
  if (!editing()) return;
  if (id === "jf") {
    if (draft && draft.media.some((m) => m.pending)) return msg("Attends la fin de l'envoi des fichiers avant de publier.");
    const w = +document.getElementById("jw").value;
    const note = document.getElementById("jn").value.trim().slice(0, 1200), weight = document.getElementById("jkg").value.trim().slice(0, 8), video = document.getElementById("jv").value.trim().slice(0, 300);
    const media = (draft && draft.w === w ? draft.media : []).filter((m) => MEDIA_ID.test(m.id)).map((m) => ({ id: m.id, kind: m.kind === "video" ? "video" : "image" })).slice(0, 12);
    if (note || weight || video || media.length) state.journal[w] = { note, weight, video, media }; else delete state.journal[w];
    renderProgress(); if (await save()) msg("Bilan publié ✓");
  } else if (id === "sf") {
    P.name = document.getElementById("sname").value.trim().slice(0, 40);
    P.handle = document.getElementById("shandle").value.trim().replace(/^@/, "").replace(/[^\w.]/g, "").slice(0, 30);
    P.goalWeight = document.getElementById("sgoal").value.trim().slice(0, 8) || null;
    P.bio = document.getElementById("sbio").value.trim().slice(0, 400);
    state.poll = { open: document.getElementById("spoll").checked };
    if (await save()) renderAll();
  } else if (id === "imf") {
    const out = document.getElementById("immsg");
    let data; try { data = JSON.parse(document.getElementById("imtxt").value); } catch { out.textContent = "Ces données ne sont pas lisibles : recopie-les en entier depuis l'ancien site."; return; }
    if (!data || typeof data !== "object" || !data.checks) { out.textContent = "Il manque les coches dans ces données."; return; }
    const journal = {};
    for (const [w, j] of Object.entries(data.journal || {})) journal[w] = { note: j.note || "", weight: j.weight || "", video: j.video || "", media: [] };
    setState({ checks: data.checks, journal, profile: { ...P, ...(data.profile || {}), handle: (data.profile && data.profile.handle) || P.handle }, poll: state.poll });
    if (await save()) { draft = null; renderAll(); document.getElementById("immsg").textContent = "Données importées et publiées ✓"; }
  }
});

// ---------- Médias ----------
function msg(t) { const m = document.getElementById("jmsg"); if (m) m.textContent = t; }
function refreshDraft() { const el = document.getElementById("jmedia"); if (el && draft) el.innerHTML = mediaGrid(draft.media, true); }
async function shrink(file) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) || file.size < 900 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file), s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    const b = await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.85));
    return b && b.size < file.size ? b : file;
  } catch { return file; }
}
async function uploadOne(file) {
  const isVid = /^video\//.test(file.type);
  if (!isVid && !/^image\//.test(file.type)) return msg("Envoie une photo ou une vidéo.");
  if (isVid && file.size > 4.5 * 1024 * 1024) return msg("Vidéo trop lourde (4,5 Mo max). Mets plutôt le lien TikTok de la vidéo.");
  const d = draft, slot = { pending: true, kind: isVid ? "video" : "image" }; d.media.push(slot); refreshDraft();
  try {
    const blob = isVid ? file : await shrink(file);
    if (blob.size > 4.5 * 1024 * 1024) throw Object.assign(new Error("Photo trop lourde (4,5 Mo max)"), { status: 413 });
    const r = await api("/api/media", { method: "POST", headers: { "content-type": blob.type || file.type, "x-dbat": "1" }, body: blob });
    slot.id = r.id; slot.kind = r.kind; delete slot.pending; msg("Fichier ajouté. Publie le bilan pour qu'il apparaisse sur le site.");
  } catch (e) {
    d.media.splice(d.media.indexOf(slot), 1);
    msg(e.status === 401 ? "Ta session a expiré : reconnecte-toi." : e.message || "L'envoi a échoué, réessaie.");
  }
  refreshDraft();
}
document.addEventListener("error", (e) => {
  const t = e.target;
  if ((t.tagName === "IMG" || t.tagName === "VIDEO") && t.closest(".media")) {
    const ph = document.createElement("span"); ph.className = "ph"; ph.textContent = t.tagName === "VIDEO" ? "Vidéo indisponible" : "Photo indisponible";
    (t.closest(".zoom") || t).replaceWith(ph);
  }
}, true);

// ---------- Démarrage ----------
shell(); document.getElementById("main").classList.add("loading"); renderAll();
const ready = load().then(checkAdmin);
// Lien secret : https://ton-domaine/#entree=TA_CLE — la clé est gardée pour la session puis retirée de la barre d'adresse.
function loginKey() { try { return sessionStorage.getItem("dbat-key") || ""; } catch { return ""; } }
const m = /^#entree=([A-Za-z0-9_-]{16,128})$/.exec(location.hash);
if (m) {
  try { sessionStorage.setItem("dbat-key", m[1]); } catch {}
  try { history.replaceState(null, "", location.pathname + location.search); } catch {}
  ready.then(() => { if (!canEdit) openSheet("login"); });
}
})();
