/* Week 05 — the Scranton branch intranet.
   Shell behaviour only: login screen, clock, navigation, scroll reveals,
   easter eggs, and filling the headline numbers from week5_office.json.
   Charts and the Who Said It? game live in week5-charts.js, which listens
   for the dm5:data event fired once the JSON has loaded. */
(function () {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const fmt = (n) => n.toLocaleString("en-US");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Per-viewer conveniences only; the page works fine when storage is blocked.
  const store = {
    get(k, d) { try { const v = localStorage.getItem("dm5." + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("dm5." + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };

  // ------------------------------------------------------------------ toasts
  function toast(title, body, icon = "\u{1F4E7}", ms = 6000) {
    const box = $("#toasts");
    const t = document.createElement("div");
    t.className = "toast bevel";
    t.innerHTML =
      `<div class="titlebar"><span class="t-name"></span>` +
      `<span class="t-btns"><span role="button" tabindex="0" aria-label="Close">&times;</span></span></div>` +
      `<div class="toast-body"><span class="big-ico" aria-hidden="true">${icon}</span><span class="msg"></span></div>`;
    $(".t-name", t).textContent = title;
    $(".msg", t).innerHTML = body;
    const close = () => t.remove();
    $(".t-btns span", t).addEventListener("click", close);
    $(".t-btns span", t).addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") close(); });
    box.appendChild(t);
    while (box.children.length > 3) box.firstChild.remove();
    if (ms) setTimeout(close, ms);
  }

  // ------------------------------------------------------------------ easter eggs
  const EGGS = ["stapler", "mug", "password", "firedrill", "bears", "chili", "mspc", "creed"];
  const found = new Set(store.get("eggs", []).filter((e) => EGGS.includes(e)));
  function renderEggs() { $("#eggs").textContent = `${found.size} / ${EGGS.length}`; }
  function egg(name) {
    if (found.has(name)) return;
    found.add(name);
    store.set("eggs", Array.from(found));
    renderEggs();
    addBucks(5);
    if (found.size === EGGS.length) {
      toast("Dundie Award", "<b>The &lsquo;Found Every Easter Egg&rsquo; Dundie</b> goes to&hellip; you. Michael would like to say a few words. (He will say many words.)", "\u{1F3C6}", 9000);
    }
  }

  let bucks = store.get("bucks", 0);
  function renderBucks() { $("#bucks").textContent = "SB$ " + fmt(bucks); }
  function addBucks(n) { bucks += n; store.set("bucks", bucks); renderBucks(); }
  // exposed for the game, which lands later
  window.DM5 = { toast, addBucks, egg };

  renderEggs();
  renderBucks();

  // 1. stapler in Jell-O
  $("#jello").addEventListener("click", () => {
    const j = $("#jello .jello");
    j.classList.remove("wobble");
    void j.offsetWidth;
    j.classList.add("wobble");
    toast("Message from D. Schrute", "<b>JIM!!!</b> My stapler is in Jell-O <i>again</i>. This is being reported to Corporate.", "\u{1F4CE}");
    egg("stapler");
  });

  // 2. World's Best Boss mug
  $("#mug").addEventListener("click", () => {
    const m = $("#mug .mug");
    m.classList.remove("steam");
    void m.offsetWidth;
    m.classList.add("steam");
    toast("World's Best Boss", "Michael bought this mug himself at Spencer Gifts. It is still the best mug.", "☕");
    egg("mug");
  });

  // 6. Kevin's chili
  $("#chili").addEventListener("click", () => {
    $("#chili").classList.add("spilled");
    $("#chili-puddle").classList.add("on");
    toast("Kevin Malone", "The trick is to undercook the onions. Everybody is going to get to know each other in the pot.", "\u{1F372}", 7000);
    egg("chili");
  });

  // 7. Michael Scott Paper Company badge
  const mspc = $$(".badge88")[2];
  mspc.setAttribute("role", "button");
  mspc.setAttribute("tabindex", "0");
  mspc.removeAttribute("aria-hidden");
  mspc.style.cursor = "pointer";
  const openMspc = () => {
    toast("Michael Scott Paper Company", "Now open for business. Out of a converted closet. Free rides in the church van to anyone who orders paper.", "\u{1F69A}");
    egg("mspc");
  };
  mspc.addEventListener("click", openMspc);
  mspc.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openMspc(); } });
  $(".badges").removeAttribute("aria-hidden");

  // 4, 5, 8: things you type anywhere on the page
  const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
  let keys = [];
  let typed = "";
  document.addEventListener("keydown", (e) => {
    if (e.target instanceof Element && e.target.closest("input, textarea, select")) return;
    keys = keys.concat(e.key.length === 1 ? e.key.toLowerCase() : e.key).slice(-KONAMI.length);
    if (keys.join() === KONAMI.join()) { fireDrill(); keys = []; }
    if (e.key.length === 1) {
      typed = (typed + e.key.toLowerCase()).slice(-12);
      if (typed.endsWith("bears")) {
        toast("Fact.", "Bears. Beets. Battlestar Galactica.", "\u{1F43B}");
        egg("bears");
      }
      if (typed.endsWith("creed")) {
        $("#creed").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
        toast("creedthoughts.gov.www", "You found Creed&rsquo;s blog. Nobody steals from Creed Bratton and gets away with it.", "\u{1F310}");
        egg("creed");
      }
    }
  });

  let drilling = false;
  function fireDrill() {
    if (drilling) return;
    drilling = true;
    egg("firedrill");
    document.body.classList.add("fire");
    const b = document.createElement("div");
    b.className = "fire-banner";
    b.setAttribute("role", "alert");
    b.innerHTML = "\u{1F525} FIRE! FIRE! \u{1F525}<br><small>The fire is shooting at us. Which exit do you use? Too slow. Dwight has started a safety drill.</small>";
    document.body.appendChild(b);
    setTimeout(() => {
      document.body.classList.remove("fire");
      b.remove();
      drilling = false;
      toast("D. Schrute, Asst. to the Regional Manager", "Fire drill complete. Everyone failed. Stanley did not move.", "\u{1F9EF}");
    }, reduceMotion ? 2500 : 5000);
  }

  // ------------------------------------------------------------------ login
  const login = $("#login");
  function closeLogin() {
    login.hidden = true;
    try { sessionStorage.setItem("dm5.loggedIn", "1"); } catch (e) { /* fine */ }
    $("#main").focus?.();
    setTimeout(() => toast("You have 1 new message", "From: <b>Dwight Schrute</b><br>Subject: Who keeps tokenizing my lines???", "\u{1F4E7}", 7000), 2500);
  }
  let loggedIn = false;
  try { loggedIn = sessionStorage.getItem("dm5.loggedIn") === "1"; } catch (e) { /* fine */ }
  if (loggedIn || location.hash) {
    login.hidden = true;
  } else {
    const user = $("#login-user");
    const pass = $("#login-pass");
    const typeInto = (el, text, mask, done) => {
      let i = 0;
      el.innerHTML = '<span class="caret"></span>';
      const step = () => {
        if (i > text.length) { done && done(); return; }
        el.innerHTML = (mask ? "•".repeat(i) : text.slice(0, i)) + '<span class="caret"></span>';
        i++;
        setTimeout(step, reduceMotion ? 0 : 90 + Math.random() * 90);
      };
      step();
    };
    typeInto(user, "mscott", false, () => {
      user.innerHTML = "mscott";
      typeInto(pass, "password1", true, () => $("#login-go").focus());
    });
    $("#login-go").addEventListener("click", () => {
      document.body.classList.add("busy");
      setTimeout(() => { document.body.classList.remove("busy"); closeLogin(); }, reduceMotion ? 0 : 700);
    });
    $("#login-skip").addEventListener("click", closeLogin);
    $("#login-hint-btn").addEventListener("click", () => { $("#login-hint").hidden = false; egg("password"); });
    document.addEventListener("keydown", function esc(e) {
      if (e.key === "Escape" && !login.hidden) { closeLogin(); document.removeEventListener("keydown", esc); }
    });
  }

  // ------------------------------------------------------------------ clock & counter
  const clock = $("#clock");
  const tick = () => { clock.textContent = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); };
  tick();
  setInterval(tick, 15000);

  const visits = store.get("visits", 0) + 1;
  store.set("visits", visits);
  $("#visitor").textContent = String(4206 + visits).padStart(7, "0");

  // ------------------------------------------------------------------ nav + reveals
  const links = $$(".side-nav a");
  const byId = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
  const windows = $$(".window");
  if ("IntersectionObserver" in window) {
    const reveal = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        en.target.classList.add("in");
        $$(".fax", en.target).forEach((f, i) => setTimeout(() => f.classList.add("printed"), 250 + i * 400));
        reveal.unobserve(en.target);
      });
    }, { threshold: 0.08 });
    windows.forEach((w) => reveal.observe(w));

    const spy = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const a = byId.get(en.target.id);
        if (!a) return;
        links.forEach((l) => { l.classList.remove("active"); l.removeAttribute("aria-current"); });
        a.classList.add("active");
        a.setAttribute("aria-current", "true");
      });
    }, { rootMargin: "-40% 0px -55% 0px" });
    windows.forEach((w) => spy.observe(w));
  } else {
    windows.forEach((w) => w.classList.add("in"));
    $$(".fax").forEach((f) => f.classList.add("printed"));
  }

  // ------------------------------------------------------------------ data
  fetch("../week5_office.json")
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(fill)
    .catch((err) => {
      console.error("[week5] could not load week5_office.json", err);
      toast("Server error", "The data file didn&rsquo;t load. (If you opened this file directly from disk, serve the folder over HTTP instead.)", "⚠️", 0);
    });

  function fill(d) {
    window.DM5.data = d;
    const m = d.meta;
    const stats = { lines: m.lines, episodes: m.episodes, tokens: m.tokens, types: m.types, speakers: m.speakers, core: d.characters.length };
    $$("[data-stat]").forEach((el) => countUp(el, stats[el.dataset.stat]));

    const t = d.tests;
    $("#verdict-content").textContent = `content words (stopwords removed): ρ = ${rho(t.content.rho_lift)}, p = ${t.content.p_lift}`;
    $("#verdict-style").textContent = `stopwords only: ρ = ${rho(t.style.rho_lift)}, p = ${t.style.p_lift}`;

    $("#twss-count").textContent = `${d.twss.length} complaints on file`;

    const weird = d.characters.slice().sort((a, b) => a.mean_content_sim - b.mean_content_sim)[0];
    $("#weirdest").textContent = weird.name;

    $("#game-ready").textContent = d.game.quotes.length;
    $("#game-cast").textContent = d.game.cast.length;

    // the charts live in week5-charts.js
    document.dispatchEvent(new CustomEvent("dm5:data", { detail: d }));
  }

  // avoids printing "-0.00"
  function rho(x) { return (Math.abs(x) < 0.005 ? 0 : x).toFixed(2); }

  function countUp(el, target) {
    if (reduceMotion || !target) { el.textContent = fmt(target); return; }
    const t0 = performance.now();
    const dur = 1100;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      el.textContent = fmt(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
})();
