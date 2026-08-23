import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ---------------------------------------------------------------------------
// Konfiguration
// ---------------------------------------------------------------------------

const SUPABASE_URL = 'https://aevbpwwksgonvlnjqpuq.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_MXZj7QgIAP8j5uFxbjvJ0g_1ImOdrfB';

// Guthaben-Gewichte + Preise. Preise gelten aktuell nur für Grünfilm (einziger
// Kunde mit shifts_enabled) — bei einem zweiten Vorkauf-Kunden mit anderen
// Preisen müsste das hier pro Kunde konfigurierbar werden.
const WEIGHTS = { full: 1, sprint: 0.75, halb: 0.5 };
const PRICES_EUR = { full: 400, sprint: 300, halb: 200 };
const PACK_SIZES = [5, 10, 15];

const COLORS = {
  bg: '#1c1712',
  accentBright: '#8fe3a0',
  accentDark: '#2f6b3f',
  accentEmail: '#8b5cf6',
  red: '#ff3b30',
  orange: '#d99a2b',
  halbBg: 'rgba(255,255,255,.14)',
};

const CONTACT = {
  whatsapp: '491795135658', // +49 179 5135658, ohne '+'/Leerzeichen
  email: 'zahlung@floachleitner.com',
};

const TZ = 'Europe/Vienna';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

// z.B. "Grünfilm" -> "gruenfilm" -> assets/logo-gruenfilm.png. Jeder Kunde
// bekommt in Phase 4 sein eigenes Repo und kann dort seine eigene Logo-Datei
// unter diesem Namen ablegen; ohne passende Datei fällt die Seite auf den
// Namen als Text zurück (s. renderHeader).
function slug(str) {
  return str
    .toLowerCase()
    .replace(/ü/g, 'ue').replace(/ö/g, 'oe').replace(/ä/g, 'ae').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function pluralize(n, singular, plural) {
  return Math.abs(Math.round(n * 100) / 100) === 1 ? singular : plural;
}

// Kundenlogos: Standardannahme ist ein einfarbiges (schwarzes) Logo auf
// transparentem Grund, das per filter:invert(1) auf dem dunklen Hintergrund
// weiß erscheint (s. Grünfilm-Logo). Mehrfarbige Logos (z. B. MediaBOX TV)
// brauchen diesen Filter nicht — hier per Slug abschaltbar.
const LOGO_INVERT_OVERRIDE = { mediabox: false };

// Kürzel pro Kunde für den Homescreen-Titel ("Flo bei GF" statt vollem
// Kundennamen — Platz unterm Apple-Touch-Icon ist auf ca. 10-11 Zeichen/Zeile
// ausgelegt). Ohne Eintrag hier fällt der Titel auf "Flo bei <Kundenname>" zurück.
const HOMESCREEN_LABEL = { gruenfilm: 'GF', mediabox: 'MB' };

// Setzt Browser-Tab-Titel + den Text, den iOS unters Homescreen-Icon
// schreibt (rel="apple-touch-icon" liegt bereits statisch im <head>, s. index.html).
function setHomescreenTitle(customerName) {
  const label = HOMESCREEN_LABEL[slug(customerName)] ?? customerName;
  const title = `Flo bei ${label}`;
  document.title = title;
  let meta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'apple-mobile-web-app-title';
    document.head.appendChild(meta);
  }
  meta.content = title;
}

// Versucht zuerst .svg, dann .png, fällt danach auf den Kundennamen als
// Text zurück (falls für den Kunden keine Logo-Datei hinterlegt ist).
window.__logoFallback = function (img) {
  if (img.dataset.stage === 'svg') {
    img.dataset.stage = 'png';
    img.src = img.dataset.pngSrc;
  } else {
    img.style.display = 'none';
    img.nextElementSibling.style.display = 'block';
  }
};

function fmtNumber(n) {
  const r = Math.round(n * 100) / 100;
  return r.toLocaleString('de-DE', { maximumFractionDigits: 2 });
}

function fmtEuro(n) {
  return `${Number(n).toLocaleString('de-DE', { maximumFractionDigits: 2 })} €`;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// visit_date kommt als reines Datum ("YYYY-MM-DD") — bewusst nicht über
// `new Date(string)` geparst, das interpretiert als UTC-Mitternacht und
// könnte je nach Browser-Zeitzone des Kunden auf den Vortag rutschen.
function parseDateOnly(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function fmtTimeVienna(iso) {
  if (!iso) return '…';
  return new Intl.DateTimeFormat('de-AT', { hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(new Date(iso));
}

function fmtStandVienna(iso) {
  if (!iso) return 'noch kein Sync';
  return new Intl.DateTimeFormat('de-AT', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(new Date(iso));
}

const WEEKDAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function isoWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Montag = 0
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // naechster Donnerstag
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((d - firstThursday) / (7 * 24 * 3600 * 1000));
}

function mondayOnOrBefore(date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // Montag = 0
  d.setDate(d.getDate() - day);
  return d;
}

const SHIFT_LABELS = { full: 'Ganzer Tag', sprint: 'Sprinttag', halb: 'Halber Tag' };

// Der Warnhinweis unter dem Ring sitzt in einer getoenten Pille statt als
// nackte farbige Zeile: sichtbar, ohne zu schreien (Flo, 2026-08-21). Die
// Schriftfarbe ist bewusst eine aufgehellte Variante des Punkt-Tons - der
// volle Ton hat auf dem getoenten Grund zu wenig Kontrast.
const WARN_STYLES = {
  knapp: {
    dot: COLORS.orange, text: '#e8b455',
    bg: 'rgba(217,154,43,.16)', border: 'rgba(217,154,43,.35)',
    label: 'Guthaben wird knapp',
  },
  aufgebraucht: {
    dot: COLORS.red, text: '#ff8078',
    bg: 'rgba(255,59,48,.16)', border: 'rgba(255,59,48,.4)',
    label: 'Guthaben aufgebraucht',
  },
};

function markerStyle(type) {
  if (type === 'full') return `width:14px;height:14px;border-radius:50%;background:${COLORS.accentDark}`;
  if (type === 'sprint') return `width:14px;height:14px;border-radius:50%;background:${COLORS.accentBright}`;
  return `width:14px;height:14px;border-radius:50%;background:${COLORS.accentBright};clip-path:inset(0 0 0 50%)`;
}

function legendMarkerStyle(type) {
  if (type === 'full') return `width:9px;height:9px;border-radius:50%;background:${COLORS.accentDark}`;
  if (type === 'sprint') return `width:9px;height:9px;border-radius:50%;background:${COLORS.accentBright}`;
  return `width:9px;height:9px;border-radius:50%;background:${COLORS.accentBright};clip-path:inset(0 0 0 50%)`;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  tab: 'monat',
  monthOffset: 0,
  legendOpen: false,
  modalOpen: false,
  selectedPack: null,
  floskel: 0,
  data: null,
};

const root = document.getElementById('app');

// ---------------------------------------------------------------------------
// Not-Found / Loading
// ---------------------------------------------------------------------------

function renderNotFound() {
  root.className = 'not-found';
  root.innerHTML = `<div style="font-size:14px;color:rgba(238,242,234,.5)">Diese Seite existiert nicht.</div>`;
}

function renderLoading() {
  root.className = '';
  root.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;font-size:13px;color:rgba(238,242,234,.4)">Lädt …</div>`;
}

// ---------------------------------------------------------------------------
// Berechnungen
// ---------------------------------------------------------------------------

// Der Ring zeigt nur die LAUFENDE Abrechnungsperiode, nicht alle Rechnungen
// zusammengezaehlt. Eine Rechnung faellt aus der Ringrechnung raus, sobald eine
// neuere bezahlte Rechnung existiert - denn die neuere enthaelt die
// Nachberechnung, die alles Offene aus der alten glattzieht (Flo, 2026-08-19).
//
// Ohne das waechst der Nenner mit jeder Rechnung mit: nach zwanzig Rechnungen
// stuende dort "115 von 120", also dauerhaft rot, obwohl gerade erst neu
// gekauft wurde.
//
// Das Kontingent der laufenden Periode ergibt sich dabei von selbst, ohne dass
// der Nachberechnungs-Anteil irgendwo gepflegt werden muesste:
//
//   Kontingent = Rechnungsmenge - Ueberziehung der Vorperiode
//
// Bei Rg. 26-07: 7 berechnete Tage - 1,75 Ueberziehung aus 26-05 = 5,25 echtes
// Kontingent. (In der Rechnung standen 2,00 Nachberechnung - dort auf einen
// glatten Wert gerundet. Massgeblich ist hier die tatsaechlich gearbeitete
// Zeit, damit "uebrig" immer dem echten Saldo entspricht.)
//
// Ausgerechnet wird das ueber den Saldo, was auf dasselbe hinauslaeuft und
// ohne Perioden-Summen auskommt:
//
//   Nenner  = Saldo + Verbrauch seit der letzten Rechnung
//   Zaehler = Verbrauch seit der letzten Rechnung
//
// Denn Saldo = alles gekauft - alles verbraucht, also ist
// Saldo + Verbrauch_seit = alles gekauft - Verbrauch_davor = Kontingent.
function computeBalanceInfo(data) {
  const balance = Number(data.balance);
  const paid = (data.purchases || []).filter((p) => p.status === 'bezahlt');
  // purchases kommen absteigend aus get_dashboard, das Maximum ist trotzdem
  // billiger zu bilden als sich auf die Sortierung zu verlassen.
  const lastPaid = paid.reduce(
    (latest, p) => (!latest || p.purchased_at > latest.purchased_at ? p : latest),
    null,
  );

  let total;
  let consumed;
  if (lastPaid) {
    const since = lastPaid.purchased_at.slice(0, 10);
    consumed = (data.visits || [])
      .filter((v) => v.visit_date > since)
      .reduce((sum, v) => sum + (WEIGHTS[v.shift_type] ?? WEIGHTS.full), 0);
    total = balance + consumed;
  } else {
    // Kunde ohne bezahlte Rechnung: nichts gekauft, nichts anzuzeigen.
    total = 0;
    consumed = 0;
  }

  const pct = total > 0 ? consumed / total : 0;
  let ringColor = COLORS.accentDark;
  if (pct >= 1) ringColor = COLORS.red;
  else if (pct >= 0.8) ringColor = COLORS.orange;
  return { total, consumed, balance, pct, ringColor };
}

function calendarWindow(monthOffset) {
  const today = new Date();
  const refMonth = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const start = mondayOnOrBefore(refMonth);
  const rows = [];
  for (let w = 0; w < 5; w++) {
    const cells = [];
    for (let c = 0; c < 7; c++) {
      const d = new Date(start);
      d.setDate(start.getDate() + w * 7 + c);
      cells.push(d);
    }
    rows.push({ kw: isoWeekNumber(cells[0]), cells });
  }
  const rangeStart = rows[0].cells[0];
  const rangeEnd = rows[4].cells[6];
  return { refMonth, rows, rangeStart, rangeEnd, today };
}

function visitsByDate(visits) {
  const map = new Map();
  for (const v of visits) map.set(v.visit_date, v);
  return map;
}

// Rechnungsdatum (purchased_at) und Zahlungsdatum (paid_at) sind zwei getrennte
// Tage - eine bezahlte Rechnung zeigt also 🧾 am Rechnungs- und ✓ am Zahlungstag,
// nicht nur eins von beiden (Flo, 2026-07-25).
function purchaseMarkersByDate(purchases) {
  const map = new Map();
  const mark = (key, field) => {
    if (!map.has(key)) map.set(key, { invoice: false, payment: false });
    map.get(key)[field] = true;
  };
  for (const p of purchases) {
    mark(dateKey(new Date(p.purchased_at)), 'invoice');
    if (p.status === 'bezahlt' && p.paid_at) mark(dateKey(new Date(p.paid_at)), 'payment');
  }
  return map;
}

// ---------------------------------------------------------------------------
// Render: Kopf
// ---------------------------------------------------------------------------

function renderHeader(data) {
  return `
    <div style="position:relative;margin-bottom:8px">
      <img src="assets/floachleitner-logo.png" alt="floachleitner.com" style="position:absolute;top:0;left:0;height:9px;width:auto;opacity:.6;filter:brightness(0) invert(1)">
      <div style="display:flex;flex-direction:column;align-items:center;padding-top:16px">
        <img src="assets/logo-${slug(data.customer.name)}.svg" data-png-src="assets/logo-${slug(data.customer.name)}.png" data-stage="svg" alt="${esc(data.customer.name)}" style="max-height:34px;max-width:140px;width:auto;height:auto;filter:${(LOGO_INVERT_OVERRIDE[slug(data.customer.name)] ?? true) ? 'invert(1)' : 'none'}" onerror="window.__logoFallback(this)">
        <span style="display:none;font-size:15px;font-weight:700">${esc(data.customer.name)}</span>
      </div>
    </div>
    ${!data.customer.shifts_enabled ? `<div style="text-align:center;font-size:9.5px;color:rgba(238,242,234,.4);margin-bottom:18px">Stand: ${esc(fmtStandVienna(data.last_sync))}</div>` : ''}
  `;
}

// ---------------------------------------------------------------------------
// Render: Guthaben-Ring
// ---------------------------------------------------------------------------

function renderRing(data, info) {
  const circumference = 2 * Math.PI * 50;
  const dash = circumference * info.pct;
  const dayWord = pluralize(info.balance, 'ganzer Tag', 'ganze Tage');
  const remainingLabel = info.balance >= 0
    ? `${fmtNumber(info.balance)} ${dayWord} übrig`
    : `${fmtNumber(Math.abs(info.balance))} ${pluralize(info.balance, 'Tag', 'Tage')} überzogen`;
  const sprintEquiv = info.balance / WEIGHTS.sprint;
  const sprintWord = pluralize(sprintEquiv, 'Sprinttag', 'Sprinttage');
  const sprintLabel = info.balance >= 0
    ? `≈ ${fmtNumber(sprintEquiv)} ${sprintWord} übrig`
    : `≈ ${fmtNumber(Math.abs(sprintEquiv))} ${sprintWord} überzogen`;

  const warn = info.pct >= 1 ? WARN_STYLES.aufgebraucht : info.pct >= 0.8 ? WARN_STYLES.knapp : null;
  const hint = warn ? `
        <div style="display:inline-flex;align-items:center;gap:7px;margin-top:6px;padding:6px 13px;border-radius:20px;background:${warn.bg};border:1px solid ${warn.border}">
          <span style="width:7px;height:7px;border-radius:50%;background:${warn.dot}"></span>
          <span style="font-size:12px;font-weight:600;color:${warn.text}">${warn.label}</span>
        </div>` : '';

  return `
    <div style="position:relative;margin:22px 0 0">
      <div style="width:184px;margin:0 auto;position:relative">
        <svg width="184" height="184" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,.09)" stroke-width="10"></circle>
          <circle cx="60" cy="60" r="50" fill="none" stroke="${info.ringColor}" stroke-width="10" stroke-dasharray="${dash} ${circumference}" stroke-linecap="round" transform="rotate(-90 60 60)"></circle>
        </svg>
        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
          <div style="font-size:34px;font-weight:700;letter-spacing:-.01em;line-height:1">${fmtNumber(info.consumed)}/${fmtNumber(info.total)}</div>
          <div style="font-size:11px;color:rgba(238,242,234,.4);margin-top:4px">verbraucht</div>
        </div>
      </div>
      <!-- Die Legende bleibt rechts neben dem Ring, ist aber nur noch halb so
           laut (Punkte 12 -> 8px, Text 12 -> 9.5px). Das haelt sie schmal genug,
           dass sie auch neben dem auf 184px gewachsenen Ring nicht anstoesst:
           bei 353px Inhaltsbreite endet der Ring bei ~269px, die Legende
           beginnt bei ~308px. -->
      <div style="position:absolute;top:50%;right:0;transform:translateY(-50%);display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;align-items:center;gap:5px">
          <span style="width:8px;height:8px;border-radius:50%;background:${COLORS.accentDark};flex:none"></span>
          <span style="font-size:9.5px;color:rgba(238,242,234,.42)">&lt; 80%</span>
        </div>
        <div style="display:flex;align-items:center;gap:5px">
          <span style="width:8px;height:8px;border-radius:50%;background:${COLORS.orange};flex:none"></span>
          <span style="font-size:9.5px;color:rgba(238,242,234,.42)">≥ 80%</span>
        </div>
        <div style="display:flex;align-items:center;gap:5px">
          <span style="width:8px;height:8px;border-radius:50%;background:${COLORS.red};flex:none"></span>
          <span style="font-size:9.5px;color:rgba(238,242,234,.42)">100%</span>
        </div>
      </div>
    </div>
    <!-- Was uebrig ist, ist die eigentliche Antwort auf die Frage des Kunden -
         deshalb die groesste Zeile der Seite (14 -> 23px), direkt unter dem
         Ring. "Stand" steht jetzt zentriert darunter statt rechts ueber dem
         Text; die frueher noetige Ruecksicht auf die Legendenbreite entfaellt
         damit (Flo, 2026-08-21). -->
    <div style="display:flex;flex-direction:column;align-items:center;gap:6px;margin:18px 0 0">
      <div style="font-size:23px;font-weight:700;line-height:1.1;text-align:center">${remainingLabel}</div>
      <div style="font-size:13px;color:rgba(238,242,234,.5)">${sprintLabel}</div>${hint}
      <div style="font-size:9.5px;color:rgba(238,242,234,.3);margin-top:8px">Stand: ${esc(fmtStandVienna(data.last_sync))}</div>
    </div>
    <div style="height:1px;background:rgba(255,255,255,.08);margin:20px 0 16px"></div>
  `;
}

// ---------------------------------------------------------------------------
// Render: Tabs
// ---------------------------------------------------------------------------

function renderTabs() {
  const base = 'flex:1;text-align:center;padding:6px 0;font-size:12.5px;cursor:pointer;border-radius:7px';
  // Der aktive Tab ist nur noch getoent statt vollflaechig gruen - vollflaechig
  // zog er mehr Blick auf sich als die Zahlen darueber (Flo, 2026-08-21).
  const on = `font-weight:600;background:rgba(143,227,160,.16);color:${COLORS.accentBright}`;
  const off = 'font-weight:500;background:transparent;color:rgba(238,242,234,.45)';
  return `
    <div style="display:flex;gap:3px;background:rgba(255,255,255,.05);border-radius:9px;padding:2px;margin-bottom:12px">
      <div data-action="tab-monat" style="${base};${state.tab === 'monat' ? on : off}">Monat</div>
      <div data-action="tab-verlauf" style="${base};${state.tab === 'verlauf' ? on : off}">Verlauf</div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Render: Monat (rollierendes 5-Wochen-Fenster)
// ---------------------------------------------------------------------------

function renderMonat(data) {
  const win = calendarWindow(state.monthOffset);
  const vByDate = visitsByDate(billedVisits(data));
  const pByDate = purchaseMarkersByDate(data.purchases);
  const todayKey = dateKey(win.today);

  // Kompakter als frueher: Zellen 36 -> 30px, Punkte 19 -> 14px, KW-Spalte
  // 26 -> 20px und nur noch die Zahl (das Wort "KW" davor war eine Zeile
  // Beiwerk), Abstaende 4 -> 3px. Spart rund 60px Hoehe, damit der groessere
  // Ring darueber ohne zusaetzliches Scrollen Platz hat (Flo, 2026-08-21).
  const gridCols = 'display:grid;grid-template-columns:20px repeat(7,1fr);gap:3px;margin-bottom:3px';

  const weekdayRow = `
    <div style="${gridCols}">
      <div></div>
      ${WEEKDAY_SHORT.map((w) => `<div style="text-align:center;font-size:8.5px;color:rgba(238,242,234,.32)">${w}</div>`).join('')}
    </div>
  `;

  const rowsHtml = win.rows.map((row) => {
    const cellsHtml = row.cells.map((d, col) => {
      const key = dateKey(d);
      const isCurrentMonth = d.getMonth() === win.refMonth.getMonth() && d.getFullYear() === win.refMonth.getFullYear();
      const isWeekend = col === 5 || col === 6;
      const isToday = key === todayKey;
      const visit = vByDate.get(key);
      const marker = visit ? purchaseAwareMarker(visit.shift_type) : null;
      const pm = pByDate.get(key);
      const cellBg = isWeekend ? 'rgba(238,242,234,.08)' : 'transparent';
      const todayStyle = isToday ? `box-shadow:inset 0 0 0 1.5px ${COLORS.accentBright}` : '';
      return `
        <div style="min-height:30px;border:1px solid rgba(255,255,255,.09);border-radius:5px;font-size:8.5px;color:rgba(238,242,234,.55);display:flex;align-items:center;justify-content:center;padding:2px;position:relative;background:${cellBg};opacity:${isCurrentMonth ? 1 : 0.35};${todayStyle}">
          <span style="position:absolute;top:2px;left:3px">${d.getDate()}</span>
          ${pm && pm.invoice ? `<span style="position:absolute;top:0px;right:1px;font-size:9px">🧾</span>` : ''}
          ${pm && pm.payment ? `<span style="position:absolute;bottom:0px;right:2px;font-size:10px;font-weight:700;color:${COLORS.accentBright}">✓</span>` : ''}
          ${marker ? `<span style="${marker}"></span>` : ''}
        </div>
      `;
    }).join('');
    return `
      <div style="${gridCols}">
        <div style="display:flex;align-items:center;justify-content:center;font-size:8px;color:rgba(238,242,234,.25)">${row.kw}</div>
        ${cellsHtml}
      </div>
    `;
  }).join('');

  const rangeLabel = `${pad2(win.rangeStart.getDate())}.${pad2(win.rangeStart.getMonth() + 1)}. – ${pad2(win.rangeEnd.getDate())}.${pad2(win.rangeEnd.getMonth() + 1)}.`;

  // Die beiden Legendenzeilen sind eingeklappt: sie erklaeren etwas, das man
  // nach dem ersten Mal weiss, standen aber dauerhaft im Weg (Flo, 2026-08-21).
  const legend = state.legendOpen ? `
    <div style="display:flex;flex-direction:column;gap:6px;align-items:center;margin:-8px 0 14px;font-size:9.5px;color:rgba(238,242,234,.45)">
      <div style="display:flex;justify-content:center;gap:12px">
        <span style="display:flex;align-items:center;gap:5px"><span style="${legendMarkerStyle('full')}"></span>Ganzer Tag</span>
        <span style="display:flex;align-items:center;gap:5px"><span style="${legendMarkerStyle('sprint')}"></span>Sprinttag</span>
        <span style="display:flex;align-items:center;gap:5px"><span style="${legendMarkerStyle('halb')}"></span>Halber Tag</span>
      </div>
      <div style="display:flex;justify-content:center;gap:12px">
        <span>🧾 Rechnung gestellt</span>
        <span>✓ Zahlung erhalten</span>
      </div>
    </div>
  ` : '';

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin:0 0 6px">
      <div data-action="month-prev" style="width:20px;height:20px;border-radius:50%;background:rgba(255,255,255,.05);display:flex;align-items:center;justify-content:center;font-size:11px;color:rgba(238,242,234,.55);cursor:pointer">←</div>
      <div style="display:flex;align-items:baseline;gap:7px">
        <div style="font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:rgba(238,242,234,.42)">${MONTH_NAMES[win.refMonth.getMonth()]} ${win.refMonth.getFullYear()}</div>
        <div style="font-size:9.5px;color:rgba(238,242,234,.28)">${rangeLabel}</div>
      </div>
      <div data-action="month-next" style="width:20px;height:20px;border-radius:50%;background:rgba(255,255,255,.05);display:flex;align-items:center;justify-content:center;font-size:11px;color:rgba(238,242,234,.55);cursor:pointer">→</div>
    </div>
    ${weekdayRow}
    ${rowsHtml}
    <div data-action="toggle-legend" style="display:flex;align-items:center;justify-content:center;gap:5px;margin:8px 0 14px;font-size:9.5px;color:rgba(238,242,234,.35);cursor:pointer;user-select:none">
      <span>${state.legendOpen ? 'Legende ausblenden' : 'Legende'}</span>
      <span style="font-size:8px">${state.legendOpen ? '▲' : '▼'}</span>
    </div>
    ${legend}
  `;
}

function purchaseAwareMarker(shiftType) {
  return markerStyle(shiftType);
}

// ---------------------------------------------------------------------------
// Render: Verlauf
// ---------------------------------------------------------------------------

function shiftBadge(type) {
  if (type === 'full') return { bg: COLORS.accentDark, fg: '#eafff0' };
  if (type === 'sprint') return { bg: COLORS.accentBright, fg: '#10160d' };
  return { bg: COLORS.halbBg, fg: '#eef2ea' };
}

// Nur Besuche ab dem ersten bezahlten Guthaben-Kauf zeigen (gleicher
// Cutover wie die Guthaben-Berechnung in get_dashboard) — aeltere Besuche
// liefen ueber das alte Abrechnungsmodell und gehoeren nicht "zur Rechnung".
// Kunden ohne Guthaben-Feature (keine bezahlten Kaeufe) sehen weiterhin alles.
// Gilt fuer Kalender UND Verlauf gleichermassen.
function billedVisits(data) {
  const paid = (data.purchases || []).filter((p) => p.status === 'bezahlt');
  if (!paid.length) return data.visits;
  const cutover = paid.reduce((min, p) => (p.purchased_at < min ? p.purchased_at : min), paid[0].purchased_at).slice(0, 10);
  return data.visits.filter((v) => v.visit_date >= cutover);
}

function visitEventRow(v) {
  const d = parseDateOnly(v.visit_date);
  const badge = shiftBadge(v.shift_type);
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.08);font-size:13.5px">
      <span style="flex:1;white-space:nowrap;font-size:12.5px">${WEEKDAY_SHORT[(d.getDay() + 6) % 7]} ${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}. · ${fmtTimeVienna(v.started_at)}–${fmtTimeVienna(v.ended_at)}</span>
      <span style="flex:none;font-size:11px;font-weight:600;padding:3px 8px;border-radius:20px;white-space:nowrap;background:${badge.bg};color:${badge.fg}">${SHIFT_LABELS[v.shift_type] || SHIFT_LABELS.full}</span>
    </div>
  `;
}

function invoiceEventRow(p) {
  const d = parseDateOnly(p.purchased_at.slice(0, 10));
  const ref = p.invoice_ref ? ` ${esc(p.invoice_ref)}` : '';
  const amount = p.amount_eur != null ? fmtEuro(p.amount_eur) : `${p.quantity} ${pluralize(p.quantity, 'Tag', 'Tage')}`;
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;margin:2px 0;border-radius:8px;background:rgba(217,154,43,.14);font-size:13.5px">
      <span style="flex:1;white-space:nowrap;font-size:12.5px;color:${COLORS.orange};font-weight:600">🧾 ${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}. · Rechnung${ref} gestellt</span>
      <span style="flex:none;font-size:11.5px;font-weight:600;color:${COLORS.orange}">${amount}</span>
    </div>
  `;
}

function paymentEventRow(p) {
  const d = parseDateOnly(p.paid_at.slice(0, 10));
  const ref = p.invoice_ref ? ` ${esc(p.invoice_ref)}` : '';
  const amount = p.amount_eur != null ? fmtEuro(p.amount_eur) : `${p.quantity} ${pluralize(p.quantity, 'Tag', 'Tage')}`;
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;margin:2px 0;border-radius:8px;background:rgba(143,227,160,.14);font-size:13.5px">
      <span style="flex:1;white-space:nowrap;font-size:12.5px;color:${COLORS.accentBright};font-weight:600">✓ ${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}. · Zahlung${ref} erhalten</span>
      <span style="flex:none;font-size:11.5px;font-weight:600;color:${COLORS.accentBright}">${amount}</span>
    </div>
  `;
}

// Verlauf mischt drei Ereignistypen (Besuch, Rechnung gestellt, Zahlung
// erhalten) chronologisch in eine Liste, statt Rechnung/Zahlung nur im
// Kalender als Icon zu zeigen (Flo, 2026-07-26). Sortiert absteigend —
// neuestes zuerst, der letzte Arbeitstag steht also ganz oben (Flo,
// 2026-08-21). Bei mehreren Ereignissen am selben Tag kommt der Besuch
// vor der Zahlung und beide vor der Rechnung; dafuer sorgt das Prio-Suffix
// am Datumsschluessel.
function renderVerlauf(data) {
  const events = [];
  for (const v of billedVisits(data)) {
    events.push({ key: `${v.visit_date}-3`, html: visitEventRow(v) });
  }
  for (const p of data.purchases || []) {
    events.push({ key: `${p.purchased_at.slice(0, 10)}-1`, html: invoiceEventRow(p) });
    if (p.status === 'bezahlt' && p.paid_at) {
      events.push({ key: `${p.paid_at.slice(0, 10)}-2`, html: paymentEventRow(p) });
    }
  }
  events.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));

  const rows = events.map((e) => e.html).join('');
  return `
    <div style="font-size:12px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:rgba(238,242,234,.4);margin:0 0 8px">Verlauf</div>
    ${rows || '<div style="font-size:12.5px;color:rgba(238,242,234,.4);padding:8px 0">Noch keine Besuche erfasst.</div>'}
    <div style="height:14px"></div>
  `;
}

// ---------------------------------------------------------------------------
// Render: Seit letzter Zahlung
// ---------------------------------------------------------------------------

function renderSummary(data) {
  const lastPaid = data.purchases.find((p) => p.status === 'bezahlt');
  const since = lastPaid ? parseDateOnly(lastPaid.purchased_at.slice(0, 10)) : null;
  const relevant = data.visits.filter((v) => !since || parseDateOnly(v.visit_date) > since);

  const counts = { full: 0, sprint: 0, halb: 0 };
  for (const v of relevant) counts[v.shift_type] = (counts[v.shift_type] || 0) + 1;

  const rows = [
    { key: 'full', label: 'ganze Tage' },
    { key: 'sprint', label: 'Sprinttage' },
    { key: 'halb', label: 'halbe Tage' },
  ].map((r) => {
    const n = counts[r.key] || 0;
    const price = PRICES_EUR[r.key];
    return `
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.08);font-size:12.5px;white-space:nowrap">
        <span style="overflow:hidden;text-overflow:ellipsis">${n} ${r.label}</span><span style="flex:none"><span style="color:rgba(238,242,234,.4);font-size:11px">à ${price}</span> ${fmtEuro(n * price)}</span>
      </div>
    `;
  }).join('');

  const total = Object.entries(counts).reduce((sum, [key, n]) => sum + n * PRICES_EUR[key], 0);

  return `
    <div style="font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:rgba(238,242,234,.35);margin:0 0 6px">Seit letzter Zahlung</div>
    ${rows}
    <div style="display:flex;justify-content:space-between;padding:8px 0 0;font-size:13px;font-weight:700">
      <span>Summe</span><span>${fmtEuro(total)}</span>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Render: Zahlungen
// ---------------------------------------------------------------------------

function renderPayments(data) {
  const rows = data.purchases.map((p) => {
    const d = parseDateOnly(p.purchased_at.slice(0, 10));
    const isOffen = p.status === 'offen';
    return `
      <div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.08)">
        <div style="display:flex;justify-content:space-between;font-size:12.5px"><span>${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} — ${p.quantity} Schichten</span><span>${p.amount_eur != null ? fmtEuro(p.amount_eur) : ''}</span></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px">
          <span style="font-size:11.5px;color:rgba(238,242,234,.45)">${p.invoice_ref ? `Rg.Nr. ${esc(p.invoice_ref)}` : ''}</span>
          <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:${isOffen ? COLORS.red : COLORS.accentBright};color:${isOffen ? '#fff' : '#10160d'}">${isOffen ? 'offen' : 'bezahlt'}</span>
        </div>
      </div>
    `;
  }).join('');
  return `
    <div style="font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:rgba(238,242,234,.35);margin:26px 0 6px">Zahlungen</div>
    ${rows || '<div style="font-size:12.5px;color:rgba(238,242,234,.4);padding:8px 0">Noch keine Zahlungen erfasst.</div>'}
    <div style="height:20px"></div>
  `;
}

// ---------------------------------------------------------------------------
// Render: Modal "Neue Rechnung anfordern"
// ---------------------------------------------------------------------------

// Vier Grussformeln, die beim Oeffnen des Modals durchrotieren (siehe
// naechsteFloskel). WhatsApp und E-Mail nehmen immer dieselbe, damit der Kunde
// nicht zwei verschiedene Tonlagen vor sich hat.
const ZAHLWORTE = ['null', 'eine', 'zwei', 'drei', 'vier', 'fuenf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwoelf', 'dreizehn', 'vierzehn', 'fuenfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn', 'zwanzig'];

function zahlwort(n) {
  return ZAHLWORTE[n] || String(n);
}

const FLOSKELN = [
  {
    // A - Barocker Kanzleistil
    betreff: (n) => `Untertänigstes Rechnungsbegehren über ${n} Tage`,
    text: (n, eur) => `Werter Schnittgroßmeister Flo,\n\nin tiefster Demut nahe ich mich Eurem Schneidetische und bitte gnädigst um Ausstellung einer Rechnung über ${n} Tage Eurer unfassbar günstigen Schnittage (${eur} €).\n\nIn immerwährender Hochachtung,\nEuer ergebenster Auftraggeber`,
  },
  {
    // B - Herold / Urkunde
    betreff: (n) => `Kund und zu wissen sei: ${n} Tage Schnittkunst begehrt`,
    text: (n, eur) => `Vernehmet, Meister der Schnitte!\n\nKund und zu wissen sei hiermit, dass begehrt werden ${n} Tage Eurer segensreichen Schnittkunst, zum Preise von ${eur} €. Möge die Rechnung alsbald ihren Weg zu mir finden.\n\nGegeben zu Wien, am heutigen Tage.`,
  },
  {
    // C - Sakral, leicht entrueckt
    betreff: (n) => `Anrufung des Timeline-Hüters — ${n} Tage`,
    text: (n, eur) => `Erhabener Hüter der Timeline,\n\nmein Projekt liegt im Dunkeln und harret Eures Schnittes. Ich erflehe ${n} Tage Eurer Gnade (${eur} €) und bitte untertänigst um das heilige Dokument der Rechnung.\n\nIn ewiger Dankbarkeit`,
  },
  {
    // D - Uebertrieben notariell
    betreff: (n) => `Antrag auf Ausfertigung einer Rechnung über ${n} Tage`,
    text: (n, eur) => `Sehr verehrter Herr Schnittgroßmeister,\n\nhiermit beantrage ich, vorbehaltlich Ihrer allergnädigsten Zustimmung, die Ausfertigung einer Rechnung über ${n} (in Worten: ${zahlwort(n)}) Tage Ihrer schlechterdings konkurrenzlos bepreisten Schnittage, mithin ${eur} €.\n\nFür die Gewährung verbleibe ich in vorauseilender Hochachtung,\nIhr sehr ergebener Kunde`,
  },
];

// Merkt sich die zuletzt benutzte Formel im localStorage, damit nicht bei jedem
// Oeffnen dieselbe kommt und auch ein App-Neustart die Reihe fortsetzt.
// localStorage kann im privaten Modus werfen - dann faengt die Reihe halt neu an.
const FLOSKEL_KEY = 'stempeluhr.floskel';

function naechsteFloskel() {
  let last = -1;
  try {
    const raw = localStorage.getItem(FLOSKEL_KEY);
    if (raw !== null) last = Number(raw);
  } catch (_) { /* egal */ }
  if (!Number.isInteger(last) || last < 0) last = -1;
  const next = (last + 1) % FLOSKELN.length;
  try { localStorage.setItem(FLOSKEL_KEY, String(next)); } catch (_) { /* egal */ }
  return next;
}

function floskel() {
  return FLOSKELN[state.floskel] || FLOSKELN[0];
}

function waLink(n) {
  const text = floskel().text(n, n * PRICES_EUR.full);
  return `https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent(text)}`;
}

function mailLink(n) {
  const f = floskel();
  const subject = f.betreff(n);
  const body = f.text(n, n * PRICES_EUR.full);
  return `mailto:${CONTACT.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function renderModal() {
  if (!state.modalOpen) return '';
  const packsHtml = PACK_SIZES.map((n) => {
    const selected = state.selectedPack === n;
    const style = `display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-radius:10px;margin-bottom:8px;cursor:pointer;background:${selected ? 'rgba(139,92,246,.18)' : 'rgba(255,255,255,.06)'};border:${selected ? `1.5px solid ${COLORS.accentEmail}` : '1.5px solid transparent'}`;
    return `
      <div data-action="select-pack" data-pack="${n}" style="${style}">
        <span style="display:flex;align-items:center;gap:8px">
          <span style="font-size:14px;font-weight:600;white-space:nowrap">${n} Tage</span>
          ${selected ? `<span style="width:18px;height:18px;border-radius:50%;background:${COLORS.accentEmail};color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center">✓</span>` : ''}
        </span>
        <span style="font-size:13.5px;color:rgba(238,242,234,.6)">${fmtEuro(n * PRICES_EUR.full)}</span>
      </div>
    `;
  }).join('');

  const packChosen = state.selectedPack !== null;
  const waStyle = `flex:2;text-align:center;padding:12px 0;border-radius:10px;font-size:12px;font-weight:700;background:${packChosen ? COLORS.accentBright : 'rgba(255,255,255,.08)'};color:${packChosen ? '#10160d' : 'rgba(238,242,234,.35)'}`;
  const mailStyle = `flex:2;text-align:center;padding:12px 0;border-radius:10px;font-size:12px;font-weight:700;background:${packChosen ? COLORS.accentEmail : 'rgba(255,255,255,.08)'};color:${packChosen ? '#fff' : 'rgba(238,242,234,.35)'}`;
  const stripeStyle = `flex:3;display:flex;align-items:center;justify-content:center;gap:5px;padding:12px 0;border-radius:10px;font-size:12.5px;font-weight:700;background:rgba(255,255,255,.08);color:rgba(238,242,234,.35)`;

  const waTag = packChosen ? `<a href="${waLink(state.selectedPack)}" target="_blank" rel="noopener" style="${waStyle};display:block;text-decoration:none">WhatsApp</a>` : `<div style="${waStyle}">WhatsApp</div>`;
  const mailTag = packChosen ? `<a href="${mailLink(state.selectedPack)}" style="${mailStyle};display:block;text-decoration:none">E-Mail</a>` : `<div style="${mailStyle}">E-Mail</div>`;

  return `
    <!-- position:FIXED, nicht absolute: #app ist so hoch wie die ganze Seite, ein
         absolut positioniertes Overlay hing daher am Seitenende statt am unteren
         Bildschirmrand. Das Sheet war dadurch nur sichtbar, wenn man ganz nach unten
         gescrollt hatte - oben fehlten 163px (gemessen 2026-08-18).
         justify-content + max-width halten es in der 460px-Spalte wie bisher;
         max-height/overflow fangen den Fall ab, dass es mal hoeher als der
         Bildschirm waere (kleines Geraet quer). -->
    <div data-action="close-modal" style="position:fixed;inset:0;background:rgba(10,8,6,.55);backdrop-filter:blur(2px);display:flex;align-items:flex-end;justify-content:center;z-index:10">
      <div data-action="stop" style="width:100%;max-width:460px;max-height:92dvh;overflow-y:auto;background:${COLORS.bg};border-top-left-radius:20px;border-top-right-radius:20px;padding:20px 20px 30px;box-shadow:0 -10px 30px rgba(0,0,0,.3)">
        <div style="width:36px;height:4px;border-radius:2px;background:rgba(255,255,255,.2);margin:0 auto 16px"></div>
        <div style="font-size:15px;font-weight:700;margin-bottom:2px">Neue Rechnung anfordern</div>
        <div style="font-size:12px;color:rgba(238,242,234,.45);margin-bottom:14px">Wie viele ganze Tage möchtest du kaufen?</div>
        ${packsHtml}
        <div style="display:flex;gap:6px;margin-top:16px">
          ${waTag}
          ${mailTag}
          <div style="${stripeStyle}">
            <svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor"><path d="M9.2 2.5c-.6.7-1.5 1.2-2.4 1.1-.1-.9.3-1.9.9-2.5.6-.7 1.6-1.2 2.4-1.2.1 1-.3 1.9-.9 2.6zm.9 1.4c-1.3-.1-2.4.7-3 .7-.6 0-1.6-.7-2.6-.7-1.3 0-2.6.8-3.2 2-1.4 2.4-.4 6 1 8 .7 1 1.5 2.1 2.6 2 1-.1 1.4-.7 2.7-.7 1.2 0 1.6.7 2.7.7 1.1 0 1.8-1 2.5-2 .8-1.1 1.1-2.2 1.1-2.3-.1 0-2.2-.8-2.2-3.2 0-2 1.6-2.9 1.7-3-1-1.4-2.5-1.5-3-1.5z"></path></svg>
            <span>Pay</span>
          </div>
        </div>
        <div style="font-size:9.5px;color:rgba(238,242,234,.3);text-align:center;margin-top:6px">Apple Pay: Design-Platzhalter, Funktion noch nicht aktiv</div>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Haupt-Render
// ---------------------------------------------------------------------------

function render() {
  const data = state.data;
  setHomescreenTitle(data.customer.name);
  root.className = '';
  root.innerHTML = `
    <div style="padding:max(20px, env(safe-area-inset-top)) 20px 0">
      ${renderHeader(data)}
      ${data.customer.shifts_enabled ? renderRing(data, computeBalanceInfo(data)) : ''}
      ${renderTabs()}
      ${state.tab === 'monat' ? renderMonat(data) : renderVerlauf(data)}
      ${data.customer.shifts_enabled ? renderSummary(data) : ''}
      ${data.customer.shifts_enabled ? renderPayments(data) : ''}
      <div style="height:20px"></div>
    </div>
    ${data.customer.shifts_enabled ? `
      <div style="position:sticky;bottom:0;padding:12px 20px max(12px, env(safe-area-inset-bottom));border-top:1px solid rgba(255,255,255,.1);background:${COLORS.bg}">
        <div data-action="open-modal" style="text-align:center;padding:13px 0;border-radius:10px;font-size:14.5px;font-weight:700;background:${COLORS.accentBright};color:#10160d;cursor:pointer">Neue Rechnung anfordern</div>
      </div>
    ` : ''}
    ${renderModal()}
  `;
}

// ---------------------------------------------------------------------------
// Events (delegiert auf #app)
// ---------------------------------------------------------------------------

root.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  if (action === 'tab-monat') { state.tab = 'monat'; render(); }
  else if (action === 'tab-verlauf') { state.tab = 'verlauf'; render(); }
  else if (action === 'month-prev') { state.monthOffset -= 1; render(); }
  else if (action === 'month-next') { state.monthOffset += 1; render(); }
  else if (action === 'toggle-legend') { state.legendOpen = !state.legendOpen; render(); }
  else if (action === 'open-modal') { state.modalOpen = true; state.floskel = naechsteFloskel(); render(); }
  else if (action === 'close-modal') { state.modalOpen = false; state.selectedPack = null; render(); }
  else if (action === 'stop') { e.stopPropagation(); }
  else if (action === 'select-pack') { state.selectedPack = Number(el.dataset.pack); render(); }
});

// ---------------------------------------------------------------------------
// Daten laden
// ---------------------------------------------------------------------------

let client = null;
let accessToken = null;
let lastLoadedAt = 0;

async function loadDashboard() {
  const { data, error } = await client.rpc('get_dashboard', { token: accessToken });
  if (error) throw error;
  if (!data) throw new Error('kein Zugriff');
  state.data = data;
  lastLoadedAt = Date.now();
}

// ---------------------------------------------------------------------------
// Pull-to-Refresh
// ---------------------------------------------------------------------------
//
// Die Daten wurden bisher genau einmal beim Laden geholt. Auf dem iPhone haelt
// iOS eine vom Homescreen gestartete Seite aber tage- bis wochenlang im
// Speicher - und im Standalone-Modus gibt es weder Adresszeile noch
// Reload-Knopf. Der Kunde sah also potenziell einen uralten Stand, ohne eine
// Moeglichkeit, das zu merken oder zu beheben (Flo, 2026-08-19).
//
// Zwei Wege dagegen: das klassische Ziehen von oben, und ein stiller Abgleich,
// sobald die App wieder in den Vordergrund kommt. Der zweite deckt den
// Normalfall ab, ohne dass jemand etwas tun muss.

const PULL_THRESHOLD = 70;   // ab hier loest Loslassen ein Neuladen aus
const PULL_MAX = 110;        // weiter laesst sich nicht ziehen
const PULL_RESISTANCE = 0.5; // Finger bewegt sich doppelt so weit wie der Inhalt
const STALE_AFTER_MS = 60_000;

const ptr = document.getElementById('ptr');
const ptrToast = document.getElementById('ptr-toast');

let pullStartY = 0;
let pullDistance = 0;
let pulling = false;
let refreshing = false;
let toastTimer = null;

// Die Transition steht bewusst inline und nicht als Klasse: render() setzt
// root.className zurueck und wuerde eine Klasse mitten im Neuladen wegwerfen.
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function setPullOffset(distance, animate) {
  pullDistance = distance;
  const shown = Math.min(distance, PULL_MAX);
  const transition = animate && !reducedMotion.matches
    ? 'transform .25s ease, opacity .25s ease'
    : '';
  ptr.style.transition = transition;
  root.style.transition = transition;
  ptr.style.transform = `translateY(${shown - 52}px)`;
  ptr.style.opacity = String(Math.min(1, distance / PULL_THRESHOLD));
  // Der Ring dreht sich beim Ziehen mit, damit klar ist, dass die Geste zieht
  // und nicht nur die Seite verschiebt.
  ptr.firstElementChild.style.transform = refreshing ? '' : `rotate(${distance * 2.6}deg)`;
  root.style.transform = shown > 0 ? `translateY(${shown}px)` : '';
}

function showToast(message) {
  ptrToast.textContent = message;
  ptrToast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ptrToast.classList.remove('show'), 2600);
}

async function refresh({ silent = false } = {}) {
  if (refreshing) return;
  refreshing = true;
  if (!silent) {
    ptr.classList.add('loading');
    setPullOffset(PULL_THRESHOLD, true);
  }
  try {
    await loadDashboard();
    render();
  } catch {
    // Alten Stand stehen lassen - ein leeres Dashboard waere schlechter als
    // ein veraltetes. Nur bei sichtbarer Geste auch sichtbar quittieren.
    if (!silent) showToast('Keine Verbindung');
  } finally {
    refreshing = false;
    if (!silent) {
      ptr.classList.remove('loading');
      setPullOffset(0, true);
    }
  }
}

function initPullToRefresh() {
  document.addEventListener('touchstart', (e) => {
    if (state.modalOpen || refreshing || e.touches.length !== 1) return;
    if (window.scrollY > 0) return;
    pullStartY = e.touches[0].clientY;
    pulling = true;
  }, { passive: true });

  // Nicht passiv: nur so laesst sich das Gummiband-Scrollen von iOS
  // unterdruecken, waehrend wirklich gezogen wird.
  document.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - pullStartY;
    if (dy <= 0 || window.scrollY > 0) {
      pulling = false;
      if (pullDistance > 0) setPullOffset(0, true);
      return;
    }
    e.preventDefault();
    setPullOffset(dy * PULL_RESISTANCE, false);
  }, { passive: false });

  const end = () => {
    if (!pulling) return;
    pulling = false;
    if (pullDistance >= PULL_THRESHOLD) refresh();
    else setPullOffset(0, true);
  };
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', end, { passive: true });

  // Rueckkehr in den Vordergrund: still nachladen, aber nur wenn der Stand
  // wirklich alt ist - kurzes Wegtippen soll keine Anfrage ausloesen.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastLoadedAt < STALE_AFTER_MS) return;
    refresh({ silent: true });
  });
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main() {
  accessToken = new URLSearchParams(window.location.search).get('t');
  if (!accessToken) { renderNotFound(); return; }

  renderLoading();
  client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

  try {
    await loadDashboard();
  } catch {
    renderNotFound();
    return;
  }

  render();
  initPullToRefresh();
}

main();
