import { useState, useRef, useMemo } from "react";

/*
  Prospect Engine — interactive mockup v2
  Changes from v1: logo removed, light/dark theme toggle, full English UI,
  paginated table, advanced filters (search, category, status, type,
  last-contact date range), sortable columns, and an automatic audit trail:
  every status change writes a timestamped entry to the contact history.
*/

const STATUSES = ["To contact", "Contacted", "No reply", "In conversation", "Not interested"];

const STATUS_COLOR = {
  "To contact": "#8A919E",
  Contacted: "#5D9BD6",
  "No reply": "#DE9B3B",
  "In conversation": "#4CAF6E",
  "Not interested": "#D95F4E",
};

const CATEGORY_COLOR = { High: "#4CAF6E", Medium: "#DE9B3B", Low: "#D95F4E" };

const today = () => new Date().toISOString().slice(0, 10);

let nextId = 200;

const SEED = [
  ["Fratellino", "High", 4.6, 505, "320 Lygon St, Carlton VIC", "fratellino.com.au", "@fratellino_au", "Restaurant", "In conversation", "2026-06-18",
    [{ date: "2026-06-18", type: "status", text: "Status changed: Contacted → In conversation" },
     { date: "2026-06-18", type: "note", text: "Replied to cold email — interested in a reel for the winter menu." },
     { date: "2026-06-10", type: "status", text: "Status changed: To contact → Contacted" },
     { date: "2026-06-10", type: "email", text: "Cold email sent (warm variant)." }]],
  ["Baia di Vino", "High", 4.7, 342, "12 Church St, Richmond VIC", "baiadivino.com.au", "@baiadivino", "Wine Bar", "To contact", null, []],
  ["Half Acre", "High", 4.5, 618, "64 Gladstone St, South Melbourne VIC", "halfacre.com.au", "@halfacre_melb", "Restaurant", "Contacted", "2026-06-24",
    [{ date: "2026-06-24", type: "status", text: "Status changed: To contact → Contacted" },
     { date: "2026-06-24", type: "email", text: "Cold email sent (technical variant)." }]],
  ["Hazel Kitchen", "Medium", 4.3, 187, "164 Flinders Ln, Melbourne VIC", "hazelkitchen.com.au", "@hazel.kitchen", "Restaurant", "No reply", "2026-05-02",
    [{ date: "2026-05-16", type: "email", text: "Follow-up email sent. No reply." },
     { date: "2026-05-16", type: "status", text: "Status changed: Contacted → No reply" },
     { date: "2026-05-02", type: "status", text: "Status changed: To contact → Contacted" }]],
  ["Marameo Espresso", "Medium", 4.2, 121, "88 Bridge Rd, Richmond VIC", "marameo.cafe", "@marameo.espresso", "Cafe", "To contact", null, []],
  ["Bright North Media", "Medium", 4.4, 96, "3/45 Smith St, Collingwood VIC", "brightnorth.com.au", "@brightnorthmedia", "Marketing Agency", "Not interested", "2026-04-11",
    [{ date: "2026-04-14", type: "note", text: "They have an in-house videographer. Revisit in 12 months." },
     { date: "2026-04-14", type: "status", text: "Status changed: Contacted → Not interested" }]],
  ["Stoker & Flame BBQ", "Low", 3.9, 64, "210 Victoria St, Richmond VIC", "", "@stokerflame", "Restaurant", "To contact", null, []],
  ["Southbank Build Co.", "Low", 4.1, 38, "19 Power St, Southbank VIC", "southbankbuild.com.au", "", "Construction Company", "To contact", null, []],
  ["Nico's Panini", "High", 4.8, 431, "260 Bourke St, Melbourne VIC", "nicospanini.com.au", "@nicos.panini", "Cafe", "Contacted", "2026-06-29",
    [{ date: "2026-06-29", type: "status", text: "Status changed: To contact → Contacted" }]],
  ["Ember & Vine", "Medium", 4.4, 143, "31 Johnston St, Fitzroy VIC", "embervine.com.au", "@ember.vine", "Bar", "No reply", "2026-03-20",
    [{ date: "2026-04-05", type: "status", text: "Status changed: Contacted → No reply" },
     { date: "2026-03-20", type: "status", text: "Status changed: To contact → Contacted" }]],
  ["Westside Scaffolding", "Low", 3.7, 22, "8 Hopkins St, Footscray VIC", "", "", "Construction Company", "To contact", null, []],
  ["Studio Meridian", "High", 4.9, 210, "2/118 Chapel St, Windsor VIC", "studiomeridian.com.au", "@studio.meridian", "Marketing Agency", "To contact", null, []],
].map((r, i) => ({
  id: i + 1, name: r[0], category: r[1], rating: r[2], reviews: r[3],
  address: r[4], website: r[5], instagram: r[6], type: r[7],
  status: r[8], lastContact: r[9], history: r[10],
}));

const SCRAPE_RESULTS = [
  ["Gilda Cantina", "High", 4.8, 274, "402 Bridge Rd, Richmond VIC", "gildacantina.com.au", "@gilda.cantina", "Restaurant"],
  ["Corner Hotel Kitchen", "Medium", 4.1, 156, "57 Swan St, Richmond VIC", "cornerkitchen.com.au", "@corner.kitchen", "Restaurant"],
  ["Lucky Coq Diner", "Low", 3.8, 47, "179 Lennox St, Richmond VIC", "", "", "Restaurant"],
];

const FAKE_ANALYSIS = {
  analysis:
    "The feed alternates phone-shot food photos in mixed lighting with occasional customer reposts. Video is completely absent: no reels in the last 60 days, even though the open kitchen is their strongest visual asset. Posting frequency is irregular (3 posts, then two weeks of silence) and stories are never saved to highlights.",
  technical:
    "Hey {name},\n\nLooking through your profile, I noticed the open kitchen never appears on video — and that's the kind of scene that carries a 20-second reel on its own. Three things I'd fix straight away: the mixed lighting in the food photos, the missing highlights, and the irregular posting rhythm.\n\nCurious if this resonates?\n\nCheers, Francesco",
  warm:
    "Hey {name},\n\nI walked past on Saturday night and you could hear the room from the footpath — but that energy never makes it onto your profile. A couple of free observations: the open kitchen deserves a reel, and the service-night stories should live in highlights.\n\nCurious if this resonates?\n\nCheers, Francesco",
  followUp:
    "Hey {name},\n\nJust circling back on my email from last week — no pressure at all. If video isn't a priority right now, fair enough. But if you'd like to see how the open kitchen would look in a reel, half an hour between services is all I'd need.\n\nCheers, Francesco",
};

/* ---------- small components ---------- */

const CategoryTag = ({ value }) => (
  <span className="cat-tag" style={{ color: CATEGORY_COLOR[value], borderColor: CATEGORY_COLOR[value] + "55", background: CATEGORY_COLOR[value] + "1A" }}>
    {value}
  </span>
);

const StatusDot = ({ value }) => (
  <span className="stato" style={{ color: STATUS_COLOR[value] }}>
    <span className="stato-dot" style={{ background: STATUS_COLOR[value] }} />
    {value}
  </span>
);

const Rating = ({ value, reviews }) => (
  <span className="mono rating">{value.toFixed(1)} <span className="dim">/ {reviews}</span></span>
);

const HISTORY_ICON = { status: "⇄", note: "✎", email: "✉" };

/* ---------- Dashboard ---------- */

const PAGE_SIZES = [5, 10, 25];

function Dashboard({ contacts, onOpen, onScrape, scraping, lastScrape }) {
  const [location, setLocation] = useState("Richmond, VIC");
  const [bizType, setBizType] = useState("Restaurant");

  const [search, setSearch] = useState("");
  const [fCat, setFCat] = useState("All");
  const [fStatus, setFStatus] = useState("All");
  const [fType, setFType] = useState("All");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState({ key: "name", dir: 1 });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  const types = useMemo(() => [...new Set(contacts.map((c) => c.type))].sort(), [contacts]);

  const filtered = useMemo(() => {
    let rows = contacts.filter((c) => {
      if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (fCat !== "All" && c.category !== fCat) return false;
      if (fStatus !== "All" && c.status !== fStatus) return false;
      if (fType !== "All" && c.type !== fType) return false;
      if (dateFrom && (!c.lastContact || c.lastContact < dateFrom)) return false;
      if (dateTo && (!c.lastContact || c.lastContact > dateTo)) return false;
      return true;
    });
    const { key, dir } = sort;
    rows.sort((a, b) => {
      const av = a[key] ?? "", bv = b[key] ?? "";
      if (av === bv) return 0;
      return (av > bv ? 1 : -1) * dir;
    });
    return rows;
  }, [contacts, search, fCat, fStatus, fType, dateFrom, dateTo, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const visible = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const setSortKey = (key) =>
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === "name" ? 1 : -1 }));

  const arrow = (key) => (sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : "");

  const resetFilters = () => {
    setSearch(""); setFCat("All"); setFStatus("All"); setFType("All");
    setDateFrom(""); setDateTo(""); setPage(0);
  };

  const toContact = contacts.filter((c) => c.status === "To contact").length;
  const filtersActive = search || fCat !== "All" || fStatus !== "All" || fType !== "All" || dateFrom || dateTo;

  return (
    <div className="page">
      <section className="panel scrape-panel">
        <div className="eyebrow">New search</div>
        <div className="scrape-row">
          <label className="field">
            <span>Location</span>
            <select value={location} onChange={(e) => setLocation(e.target.value)}>
              <option>Richmond, VIC</option><option>Carlton, VIC</option>
              <option>South Melbourne, VIC</option><option>Fitzroy, VIC</option>
              <option>Melbourne CBD, VIC</option>
            </select>
          </label>
          <label className="field">
            <span>Business category</span>
            <select value={bizType} onChange={(e) => setBizType(e.target.value)}>
              <option>Restaurant</option><option>Cafe</option><option>Bar</option>
              <option>Marketing Agency</option><option>Construction Company</option>
            </select>
          </label>
          <button className="btn-primary" onClick={() => onScrape(location, bizType)} disabled={scraping}>
            {scraping ? <><span className="rec-dot" /> Searching…</> : "Start search"}
          </button>
        </div>
        {lastScrape && !scraping && (
          <div className="scrape-result mono">✓ {lastScrape.n} new contacts from {lastScrape.location} · {lastScrape.type}</div>
        )}
      </section>

      <section className="panel list-panel">
        <div className="list-head">
          <div>
            <div className="eyebrow">Contacts</div>
            <div className="list-count mono">
              {filtered.length} <span className="dim">of {contacts.length}</span>
              <span className="dim"> · {toContact} to contact</span>
            </div>
          </div>
        </div>

        <div className="filter-bar">
          <input
            type="search" placeholder="Search by name…" value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          />
          <select value={fCat} onChange={(e) => { setFCat(e.target.value); setPage(0); }}>
            <option value="All">Category: all</option>
            <option>High</option><option>Medium</option><option>Low</option>
          </select>
          <select value={fStatus} onChange={(e) => { setFStatus(e.target.value); setPage(0); }}>
            <option value="All">Status: all</option>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <select value={fType} onChange={(e) => { setFType(e.target.value); setPage(0); }}>
            <option value="All">Type: all</option>
            {types.map((t) => <option key={t}>{t}</option>)}
          </select>
          <label className="date-filter">
            <span className="dim">Last contact from</span>
            <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0); }} />
          </label>
          <label className="date-filter">
            <span className="dim">to</span>
            <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0); }} />
          </label>
          {filtersActive && <button className="btn-ghost small" onClick={resetFilters}>Clear filters</button>}
        </div>

        <table className="contacts">
          <thead>
            <tr>
              <th className="sortable" onClick={() => setSortKey("name")}>Business{arrow("name")}</th>
              <th className="sortable" onClick={() => setSortKey("category")}>Category{arrow("category")}</th>
              <th className="right sortable" onClick={() => setSortKey("rating")}>Rating{arrow("rating")}</th>
              <th className="sortable" onClick={() => setSortKey("status")}>Status{arrow("status")}</th>
              <th className="right sortable" onClick={() => setSortKey("lastContact")}>Last contact{arrow("lastContact")}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => (
              <tr key={c.id} onClick={() => onOpen(c.id)}>
                <td>
                  <div className="biz-name">{c.name}</div>
                  <div className="biz-sub">{c.type} · {c.address.split(",")[1]?.trim() || c.address}</div>
                </td>
                <td><CategoryTag value={c.category} /></td>
                <td className="right"><Rating value={c.rating} reviews={c.reviews} /></td>
                <td><StatusDot value={c.status} /></td>
                <td className="right mono dim">{c.lastContact || "—"}</td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={5} className="empty">No contacts match these filters. Try widening them.</td></tr>
            )}
          </tbody>
        </table>

        <div className="pager">
          <label className="pager-size">
            <span className="dim">Rows per page</span>
            <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}>
              {PAGE_SIZES.map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
          <div className="pager-nav">
            <button className="btn-ghost small" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>← Prev</button>
            <span className="mono dim">Page {safePage + 1} of {pages}</span>
            <button className="btn-ghost small" disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)}>Next →</button>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ---------- Detail ---------- */

function Detail({ contact, onBack, onUpdate, onStatusChange }) {
  const [screens, setScreens] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);
  const [emails, setEmails] = useState(null);
  const [newNote, setNewNote] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  const addFiles = (fileList) => {
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    files.slice(0, 10 - screens.length).forEach((f) => {
      const reader = new FileReader();
      reader.onload = () =>
        setScreens((prev) => (prev.length < 10 ? [...prev, { name: f.name, src: reader.result }] : prev));
      reader.readAsDataURL(f);
    });
  };

  const generate = () => {
    setGenerating(true);
    setResult(null);
    setTimeout(() => {
      setResult(FAKE_ANALYSIS.analysis);
      setEmails({
        technical: FAKE_ANALYSIS.technical.replaceAll("{name}", contact.name),
        warm: FAKE_ANALYSIS.warm.replaceAll("{name}", contact.name),
        followUp: FAKE_ANALYSIS.followUp.replaceAll("{name}", contact.name),
      });
      setGenerating(false);
    }, 2200);
  };

  const addNote = () => {
    if (!newNote.trim()) return;
    onUpdate(contact.id, {
      history: [{ date: today(), type: "note", text: newNote.trim() }, ...contact.history],
    });
    setNewNote("");
  };

  return (
    <div className="page">
      <button className="back" onClick={onBack}>← All contacts</button>

      <header className="detail-head">
        <div>
          <h1>{contact.name}</h1>
          <div className="detail-meta">
            <span>{contact.address}</span>
            {contact.website && <a href={"https://" + contact.website} onClick={(e) => e.preventDefault()}>{contact.website}</a>}
            {contact.instagram && <span className="mono">{contact.instagram}</span>}
          </div>
        </div>
        <div className="detail-badges">
          <CategoryTag value={contact.category} />
          <Rating value={contact.rating} reviews={contact.reviews} />
        </div>
      </header>

      <div className="detail-grid">
        <div className="col-main">
          <section className="panel">
            <div className="eyebrow">Instagram screenshots <span className="mono dim">{screens.length}/10</span></div>
            <div
              className={"dropzone" + (dragOver ? " over" : "") + (screens.length >= 10 ? " full" : "")}
              onClick={() => screens.length < 10 && fileRef.current.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
            >
              {screens.length === 0 ? (
                <p>Drag profile screenshots here, or click to browse.<br /><span className="dim">JPG, PNG or WebP — up to 10.</span></p>
              ) : (
                <div className="thumbs">
                  {screens.map((s, i) => (
                    <div key={i} className="thumb">
                      <img src={s.src} alt={s.name} />
                      <button className="thumb-x" aria-label={"Remove " + s.name}
                        onClick={(e) => { e.stopPropagation(); setScreens(screens.filter((_, j) => j !== i)); }}>×</button>
                    </div>
                  ))}
                  {screens.length < 10 && <div className="thumb add">+</div>}
                </div>
              )}
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
            </div>

            <button className="btn-primary wide" onClick={generate} disabled={screens.length === 0 || generating}>
              {generating ? <><span className="rec-dot" /> Analysing…</> : "Generate emails"}
            </button>
            {screens.length === 0 && !result && (
              <p className="hint dim">Upload at least one screenshot to run the analysis.</p>
            )}
          </section>

          {generating && (
            <section className="panel generating"><div className="blur-in">Claude is looking at the profile…</div></section>
          )}

          {result && emails && (
            <>
              <section className="panel">
                <div className="eyebrow">Analysis</div>
                <p className="analysis">{result}</p>
              </section>
              <section className="panel">
                <div className="eyebrow">Cold email — technical variant</div>
                <textarea rows={9} value={emails.technical} onChange={(e) => setEmails({ ...emails, technical: e.target.value })} />
              </section>
              <section className="panel">
                <div className="eyebrow">Cold email — warm variant</div>
                <textarea rows={9} value={emails.warm} onChange={(e) => setEmails({ ...emails, warm: e.target.value })} />
              </section>
              <section className="panel">
                <div className="eyebrow">Follow-up</div>
                <textarea rows={7} value={emails.followUp} onChange={(e) => setEmails({ ...emails, followUp: e.target.value })} />
              </section>
            </>
          )}
        </div>

        <aside className="col-side">
          <section className="panel">
            <div className="eyebrow">Contact status</div>
            <select value={contact.status} onChange={(e) => onStatusChange(contact.id, e.target.value)}>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <p className="hint dim">Changing the status records the date automatically and adds an entry to the history below.</p>
            <label className="field top-gap">
              <span>Last contact date</span>
              <input type="date" value={contact.lastContact || ""}
                onChange={(e) => onUpdate(contact.id, { lastContact: e.target.value })} />
            </label>
          </section>

          <section className="panel">
            <div className="eyebrow">History</div>
            <div className="nota-add">
              <textarea rows={2} placeholder="Add a note…" value={newNote} onChange={(e) => setNewNote(e.target.value)} />
              <button className="btn-ghost" onClick={addNote}>Save note</button>
            </div>
            {contact.history.length === 0 ? (
              <p className="dim hint">No activity recorded for this contact yet.</p>
            ) : (
              <ul className="timeline">
                {contact.history.map((h, i) => (
                  <li key={i} className={"hist-" + h.type}>
                    <span className="mono dim">{HISTORY_ICON[h.type]} {h.date}</span>
                    <p>{h.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

/* ---------- App ---------- */

export default function App() {
  const [contacts, setContacts] = useState(SEED);
  const [view, setView] = useState({ name: "dashboard" });
  const [scraping, setScraping] = useState(false);
  const [lastScrape, setLastScrape] = useState(null);
  const [theme, setTheme] = useState("dark");

  const onScrape = (location, type) => {
    setScraping(true);
    setLastScrape(null);
    setTimeout(() => {
      const existing = new Set(contacts.map((c) => c.name));
      const fresh = SCRAPE_RESULTS.filter((r) => !existing.has(r[0])).map((r) => ({
        id: nextId++, name: r[0], category: r[1], rating: r[2], reviews: r[3],
        address: r[4], website: r[5], instagram: r[6], type: r[7],
        status: "To contact", lastContact: null,
        history: [{ date: today(), type: "note", text: `Imported from Google Maps search — ${location}, ${type}.` }],
      }));
      setContacts((prev) => [...fresh, ...prev]);
      setLastScrape({ n: fresh.length, location, type });
      setScraping(false);
    }, 2600);
  };

  const onUpdate = (id, patch) =>
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const onStatusChange = (id, newStatus) =>
    setContacts((prev) =>
      prev.map((c) => {
        if (c.id !== id || c.status === newStatus) return c;
        return {
          ...c,
          status: newStatus,
          lastContact: today(),
          history: [
            { date: today(), type: "status", text: `Status changed: ${c.status} → ${newStatus}` },
            ...c.history,
          ],
        };
      })
    );

  const current = view.name === "detail" ? contacts.find((c) => c.id === view.id) : null;

  return (
    <div className={"app " + theme}>
      <style>{css}</style>
      <nav className="topbar">
        <div className="brand" onClick={() => setView({ name: "dashboard" })}>Prospect Engine</div>
        <div className="topbar-right">
          <span className="mono dim">Melbourne · {new Date().toLocaleDateString("en-AU")}</span>
          <button
            className="btn-ghost small theme-toggle"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "☀ Light" : "☾ Dark"}
          </button>
        </div>
      </nav>

      {view.name === "dashboard" ? (
        <Dashboard contacts={contacts} onOpen={(id) => setView({ name: "detail", id })}
          onScrape={onScrape} scraping={scraping} lastScrape={lastScrape} />
      ) : (
        <Detail contact={current} onBack={() => setView({ name: "dashboard" })}
          onUpdate={onUpdate} onStatusChange={onStatusChange} />
      )}
    </div>
  );
}

/* ---------- styles ---------- */

const css = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap');

* { box-sizing: border-box; margin: 0; }

.app {
  /* dark theme (default) */
  --bg: #101216;
  --panel: #171A20;
  --panel-up: #1D2129;
  --line: #262B35;
  --line-soft: #20242D;
  --text: #E7E4DD;
  --text-dim: #9DA3AE;
  --text-faint: #6B7280;
  --accent: #E5A445;
  --accent-text: #17130A;
  --rec: #E05C4B;
  --ok: #4CAF6E;

  min-height: 100vh;
  background: var(--bg);
  color: var(--text);
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  transition: background .25s, color .25s;
}

.app.light {
  --bg: #F5F3EE;
  --panel: #FFFFFF;
  --panel-up: #F0EDE6;
  --line: #DDD8CE;
  --line-soft: #E7E3DA;
  --text: #23262B;
  --text-dim: #6B7078;
  --text-faint: #9AA0A8;
  --accent: #C07E1E;
  --accent-text: #FFFDF8;
  --rec: #C94A3A;
  --ok: #2E8B57;
}

.mono { font-family: 'IBM Plex Mono', monospace; font-size: 12.5px; }
.dim { color: var(--text-dim); }
.right { text-align: right; }

.topbar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 28px; border-bottom: 1px solid var(--line);
  background: var(--panel);
  position: sticky; top: 0; z-index: 10;
}
.brand {
  font-family: 'Archivo', sans-serif; font-weight: 700;
  font-stretch: 112%; letter-spacing: .05em; font-size: 15px;
  text-transform: uppercase; cursor: pointer; user-select: none;
}
.topbar-right { display: flex; align-items: center; gap: 16px; font-size: 11.5px; }
.theme-toggle { min-width: 76px; }

.page { max-width: 1140px; margin: 0 auto; padding: 28px 28px 64px; }

.eyebrow {
  font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: .12em;
  text-transform: uppercase; color: var(--text-dim); margin-bottom: 14px;
  display: flex; justify-content: space-between; align-items: baseline;
}

.panel {
  background: var(--panel); border: 1px solid var(--line);
  border-radius: 10px; padding: 20px;
}
.scrape-panel { margin-bottom: 24px; }
.panel + .panel { margin-top: 16px; }

.field { display: flex; flex-direction: column; gap: 6px; }
.field span { font-size: 12px; color: var(--text-dim); }
.top-gap { margin-top: 14px; }
select, input[type=date], input[type=search], textarea {
  background: var(--panel-up); color: var(--text);
  border: 1px solid var(--line); border-radius: 7px;
  padding: 9px 12px; font: inherit; width: 100%;
}
select:focus, input:focus, textarea:focus, button:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 1px;
}
textarea { resize: vertical; line-height: 1.6; font-size: 13.5px; }

.scrape-row { display: grid; grid-template-columns: 1fr 1fr auto; gap: 14px; align-items: end; }
.scrape-result { margin-top: 12px; color: var(--ok); }

.btn-primary {
  background: var(--accent); color: var(--accent-text); border: none; border-radius: 7px;
  padding: 10px 20px; font-weight: 600; font-size: 14px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 8px; justify-content: center;
  transition: filter .15s;
}
.btn-primary:hover:not(:disabled) { filter: brightness(1.08); }
.btn-primary:disabled { opacity: .55; cursor: default; }
.btn-primary.wide { width: 100%; margin-top: 16px; }
.btn-ghost {
  background: none; border: 1px solid var(--line); color: var(--text);
  border-radius: 7px; padding: 7px 14px; cursor: pointer; font: inherit; font-size: 13px;
}
.btn-ghost:hover:not(:disabled) { border-color: var(--accent); }
.btn-ghost:disabled { opacity: .4; cursor: default; }
.btn-ghost.small { padding: 6px 12px; font-size: 12.5px; }

.rec-dot {
  width: 8px; height: 8px; border-radius: 50%; background: var(--rec);
  animation: pulse 1.1s ease-in-out infinite;
}
@keyframes pulse { 50% { opacity: .25; } }
@media (prefers-reduced-motion: reduce) {
  .rec-dot { animation: none; }
  .blur-in { animation: none !important; filter: none !important; }
}

.list-head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 14px; gap: 16px; flex-wrap: wrap; }
.list-count { font-size: 15px; }

.filter-bar {
  display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
  padding: 12px; background: var(--panel-up); border: 1px solid var(--line-soft);
  border-radius: 8px; margin-bottom: 16px;
}
.filter-bar input[type=search] { width: 190px; }
.filter-bar select { width: auto; }
.date-filter { display: flex; align-items: center; gap: 7px; font-size: 12px; }
.date-filter input { width: 140px; padding: 7px 9px; }

table.contacts { width: 100%; border-collapse: collapse; }
.contacts th {
  font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 500;
  text-transform: uppercase; letter-spacing: .1em; color: var(--text-faint);
  text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--line);
  user-select: none;
}
.contacts th.sortable { cursor: pointer; }
.contacts th.sortable:hover { color: var(--text); }
.contacts th.right { text-align: right; }
.contacts td { padding: 13px 12px; border-bottom: 1px solid var(--line-soft); }
.contacts tbody tr { cursor: pointer; transition: background .12s; }
.contacts tbody tr:hover { background: var(--panel-up); }
.biz-name { font-weight: 600; }
.biz-sub { font-size: 12px; color: var(--text-faint); margin-top: 2px; }
.empty { text-align: center; color: var(--text-dim); padding: 32px 0 !important; }

.pager { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; flex-wrap: wrap; gap: 12px; }
.pager-size { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.pager-size select { width: auto; padding: 6px 10px; }
.pager-nav { display: flex; align-items: center; gap: 12px; }

.cat-tag {
  font-family: 'IBM Plex Mono', monospace; font-size: 11.5px; font-weight: 500;
  padding: 3px 10px; border-radius: 4px; border: 1px solid; letter-spacing: .05em;
}
.stato { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; }
.stato-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.rating { font-size: 13px; }

.back {
  background: none; border: none; color: var(--text-dim); cursor: pointer;
  font: inherit; font-size: 13px; padding: 0; margin-bottom: 18px;
}
.back:hover { color: var(--text); }
.detail-head {
  display: flex; justify-content: space-between; align-items: flex-start;
  gap: 20px; margin-bottom: 24px; flex-wrap: wrap;
}
.detail-head h1 {
  font-family: 'Archivo', sans-serif; font-weight: 700; font-stretch: 110%;
  font-size: 28px; letter-spacing: .01em; margin-bottom: 6px;
}
.detail-meta { display: flex; gap: 16px; flex-wrap: wrap; color: var(--text-dim); font-size: 13px; }
.detail-meta a { color: var(--accent); text-decoration: none; }
.detail-badges { display: flex; align-items: center; gap: 14px; }

.detail-grid { display: grid; grid-template-columns: 1fr 320px; gap: 20px; align-items: start; }
@media (max-width: 860px) {
  .detail-grid { grid-template-columns: 1fr; }
  .scrape-row { grid-template-columns: 1fr; }
}

.dropzone {
  border: 1.5px dashed var(--line); border-radius: 8px; padding: 22px;
  text-align: center; color: var(--text-dim); cursor: pointer;
  transition: border-color .15s, background .15s;
}
.dropzone.over { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 6%, transparent); }
.dropzone.full { cursor: default; }
.thumbs { display: flex; flex-wrap: wrap; gap: 10px; }
.thumb {
  position: relative; width: 84px; height: 84px; border-radius: 6px;
  overflow: hidden; border: 1px solid var(--line); background: var(--panel-up);
}
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.thumb.add {
  display: flex; align-items: center; justify-content: center;
  font-size: 24px; color: var(--text-faint); border-style: dashed;
}
.thumb-x {
  position: absolute; top: 3px; right: 3px; width: 20px; height: 20px;
  border-radius: 50%; border: none; background: rgba(0,0,0,.65); color: #fff;
  cursor: pointer; font-size: 13px; line-height: 1;
}

.generating { text-align: center; padding: 36px 20px; }
.blur-in {
  font-family: 'Archivo', sans-serif; font-size: 16px; color: var(--text-dim);
  animation: focusIn 2.2s ease-out forwards;
}
@keyframes focusIn { from { filter: blur(6px); opacity: .3; } to { filter: blur(0); opacity: 1; } }

.analysis { font-size: 14px; line-height: 1.7; }
.hint { font-size: 12.5px; margin-top: 10px; }

.nota-add { display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px; }
.nota-add .btn-ghost { align-self: flex-end; }
.timeline { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 14px; }
.timeline li { border-left: 2px solid var(--line); padding-left: 12px; }
.timeline li.hist-status { border-left-color: var(--accent); }
.timeline p { margin-top: 2px; font-size: 13px; }
`;
