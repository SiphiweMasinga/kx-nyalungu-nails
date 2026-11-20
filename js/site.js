// KX Nyalungu Nails — public site logic.
// With Supabase configured, content comes from the database and bookings go through the
// kx-api Edge Function. Without it, the site runs in demo mode on js/demo-data.js.
(() => {
  const cfg = window.KX_CONFIG ?? {};
  const live = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
  const sb = live && window.supabase ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;
  const demo = window.KX_DEMO;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const rand = (cents) => `R${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  let content = null;

  // ---------- Data ----------

  async function loadContent() {
    if (!sb) return { ...demo };
    const today = new Date().toISOString().slice(0, 10);
    const settingsColumns =
      "business_name, tagline, about, phone, whatsapp, email, address, facebook, instagram, tiktok, deposit_type, deposit_value, house_call_fee_cents, slot_interval_minutes, booking_notice_hours, eft_details, policies, owner_name, owner_bio, owner_photo_url";
    const [settings, services, addons, specials, gallery, hours, blocked, holidays] = await Promise.all([
      sb.from("settings").select(settingsColumns).eq("id", 1).single(),
      sb.from("services").select("*").eq("active", true).order("sort"),
      sb.from("addons").select("*").eq("active", true).order("sort"),
      sb.from("specials").select("*").order("ends_on"),
      sb.from("gallery").select("*").order("sort").order("created_at", { ascending: false }),
      sb.from("business_hours").select("*").order("weekday"),
      sb.from("blocked_dates").select("day").gte("day", today),
      sb.from("holiday_periods").select("*").gte("ends_on", today).order("starts_on"),
    ]);
    const failed = [settings, services, addons, specials, gallery, hours, blocked, holidays].find((r) => r.error);
    if (failed) throw failed.error;
    return {
      settings: settings.data,
      services: services.data,
      addons: addons.data,
      specials: specials.data,
      gallery: gallery.data,
      hours: hours.data,
      blocked_dates: blocked.data.map((b) => b.day),
      holidays: holidays.data,
    };
  }

  // Working hours for a date ("YYYY-MM-DD"): school holidays override the weekly hours.
  function rulesFor(iso) {
    if (content.blocked_dates.includes(iso)) return null;
    const holiday = (content.holidays ?? []).find((p) => p.starts_on <= iso && p.ends_on >= iso);
    if (holiday) return { ...holiday, holiday: true };
    const hours = content.hours.find((h) => h.weekday === new Date(`${iso}T12:00:00`).getDay());
    return hours && !hours.closed ? hours : null;
  }

  const shortDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });

  async function api(action, body) {
    const response = await fetch(`${cfg.supabaseUrl.replace(/\/$/, "")}/functions/v1/kx-api`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: cfg.supabaseAnonKey,
        Authorization: `Bearer ${cfg.supabaseAnonKey}`,
      },
      body: JSON.stringify({ action, ...body }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
    return data;
  }

  // ---------- Helpers ----------

  function whatsappUrl(text = "") {
    const number = (content.settings.whatsapp || "").replace(/\D/g, "");
    if (!number) return null;
    return `https://wa.me/${number}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
  }

  // The Facebook setting can be a full page link or just a page name.
  function facebookUrl() {
    const value = (content.settings.facebook || "").trim();
    if (!value) return null;
    return /^https?:\/\//i.test(value) ? value : `https://www.facebook.com/search/top?q=${encodeURIComponent(value)}`;
  }

  function imageEl(url, alt, className = "") {
    if (!url) {
      const div = document.createElement("div");
      div.className = `img-fallback ${className}`.trim();
      return div;
    }
    const img = document.createElement("img");
    img.src = url;
    img.alt = alt;
    img.loading = "lazy";
    if (className) img.className = className;
    img.addEventListener("error", () => img.replaceWith(imageEl("", alt, className)), { once: true });
    return img;
  }

  function depositFor(totalCents) {
    const s = content.settings;
    if (s.deposit_type === "none") return 0;
    if (s.deposit_type === "fixed") return Math.min(s.deposit_value * 100, totalCents);
    return Math.round((totalCents * Math.min(s.deposit_value, 100)) / 100);
  }

  function specialFor(serviceId) {
    return content.specials.find((s) => s.service_id === serviceId && s.special_price_cents != null);
  }

  function priceOf(service) {
    return specialFor(service.id)?.special_price_cents ?? service.price_cents;
  }

  // ---------- Rendering ----------

  function renderText() {
    const s = content.settings;
    $$("[data-field]").forEach((el) => {
      el.textContent = s[el.dataset.field] || "";
    });
    $$("[data-whatsapp-link]").forEach((a) => {
      const url = whatsappUrl("Hi KX Nyalungu Nails! I'd like to ask about a booking 💅");
      if (url) a.href = url;
      else a.hidden = true;
    });
    const cheapest = Math.min(...content.services.map(priceOf));
    if (Number.isFinite(cheapest)) $("[data-from-price]").textContent = rand(cheapest);
    $("[data-deposit-label]").textContent =
      s.deposit_type === "percent" ? `${s.deposit_value}%` : s.deposit_type === "fixed" ? `R${s.deposit_value}` : "No";
    if (s.house_call_fee_cents > 0) {
      $("[data-housecall-fee]").textContent = `+${rand(s.house_call_fee_cents)}`;
      $("[data-housecall-note]").textContent = `House calls: we come to you for an extra ${rand(s.house_call_fee_cents)}.`;
      $("[data-housecall-fee-label]").textContent = `+${rand(s.house_call_fee_cents)}`;
    } else {
      $("[data-housecall-fee]").closest("li").hidden = true;
      $("[data-housecall-check]").closest(".toggle").hidden = true;
    }
    const fb = facebookUrl();
    if (fb) {
      const link = document.createElement("a");
      link.href = fb;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "KX Nyalungu ↗";
      $(".gallery-cta strong").replaceChildren(link);
    } else {
      $(".gallery-cta").hidden = true;
    }
    $("[data-year]").textContent = new Date().getFullYear();
  }

  function renderSpecials() {
    const section = $("#specials");
    const grid = $("[data-specials]");
    const navLink = $("[data-nav-specials]");
    grid.replaceChildren();

    if (!content.specials.length) {
      if (live) {
        section.hidden = true;
        navLink.hidden = true;
        return;
      }
      section.hidden = false;
      const note = document.createElement("p");
      note.className = "demo-note";
      note.textContent =
        "Specials posted from the owner dashboard appear here automatically, with their start and end dates.";
      grid.append(note);
      return;
    }

    section.hidden = false;
    content.specials.forEach((special) => {
      const card = document.createElement("article");
      card.className = "special-card";
      card.append(imageEl(special.image_url, special.title, "special-img"));
      if (special.badge) {
        const badge = document.createElement("span");
        badge.className = "special-badge";
        badge.textContent = special.badge;
        card.append(badge);
      }
      const body = document.createElement("div");
      body.className = "special-body";
      const service = content.services.find((s) => s.id === special.service_id);
      body.innerHTML = `<h3></h3><p></p><div class="special-meta"><span></span><strong></strong></div>`;
      $("h3", body).textContent = special.title;
      $("p", body).textContent = special.description;
      $(".special-meta span", body).textContent = `Ends ${new Date(`${special.ends_on}T12:00:00`).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}`;
      $(".special-meta strong", body).textContent = special.special_price_cents != null ? rand(special.special_price_cents) : "";
      if (service) {
        const book = document.createElement("a");
        book.className = "button button-pink";
        book.href = "#book";
        book.textContent = "Book this special";
        book.addEventListener("click", () => selectService(service.id));
        body.append(book);
      }
      card.append(body);
      grid.append(card);
    });
  }

  function renderMenu() {
    const groups = new Map();
    content.services.forEach((service) => {
      const key = service.category || "Services";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(service);
    });

    const menu = $("[data-menu]");
    menu.replaceChildren();
    groups.forEach((services, category) => {
      const group = document.createElement("article");
      group.className = "menu-group";
      const title = document.createElement("h3");
      title.textContent = category;
      group.append(title);
      services.forEach((service) => {
        const item = document.createElement("div");
        item.className = "menu-item";
        const special = specialFor(service.id);
        item.innerHTML = `
          <span class="menu-item-name"></span>
          <span class="menu-item-price">${special ? `<s>${rand(service.price_cents)}</s>` : ""}<strong></strong>
            <a class="button button-pink menu-book" href="#book">Book</a></span>
          <span class="menu-item-meta"></span>`;
        $(".menu-item-name", item).textContent = service.name;
        $(".menu-item-price strong", item).textContent = rand(priceOf(service));
        $(".menu-item-meta", item).textContent = `${service.duration_minutes} min${service.description ? ` · ${service.description}` : ""}`;
        $(".menu-book", item).addEventListener("click", () => selectService(service.id));
        group.append(item);
      });
      menu.append(group);
    });

    const chips = $("[data-addons]");
    chips.replaceChildren();
    content.addons.forEach((addon) => {
      const li = document.createElement("li");
      li.innerHTML = `<span></span> <b></b>`;
      $("span", li).textContent = addon.name;
      $("b", li).textContent = `+${rand(addon.price_cents)}`;
      chips.append(li);
    });
    if (!content.addons.length) $(".addons-box h3").hidden = true;
  }

  function renderGallery() {
    const grid = $("[data-gallery]");
    grid.replaceChildren();
    content.gallery.forEach((photo) => {
      const figure = document.createElement("figure");
      figure.style.margin = "0";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "gallery-item";
      button.setAttribute("aria-label", `View photo: ${photo.caption || "nail design"}`);
      button.append(imageEl(photo.image_url, photo.caption || "Nail design"));
      if (photo.caption) {
        const caption = document.createElement("figcaption");
        caption.textContent = photo.caption;
        button.append(caption);
      }
      button.addEventListener("click", () => openLightbox(photo));
      figure.append(button);
      grid.append(figure);
    });
    if (!content.gallery.length) $("#gallery").hidden = true;
  }

  function renderAbout() {
    const s = content.settings;
    if (!s.owner_bio && !s.owner_photo_url) {
      $("#about").hidden = true;
      $('a[href="#about"]').hidden = true;
      return;
    }
    $("[data-owner-bio]").textContent = s.owner_bio || "";
    if (s.owner_name) {
      const heading = $("[data-owner-heading]");
      heading.textContent = "Meet ";
      const name = document.createElement("span");
      name.className = "chrome-text";
      name.textContent = `${s.owner_name}.`;
      heading.append(name);
      $("[data-owner-photo]").alt = `${s.owner_name}, owner of KX Nyalungu Nails`;
    }
    const photo = $("[data-owner-photo]");
    if (s.owner_photo_url) photo.src = s.owner_photo_url;
    else photo.closest("figure").hidden = true;
  }

  function renderVisit() {
    const s = content.settings;
    const list = $("[data-contact]");
    list.replaceChildren();
    const add = (icon, label, href) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="icon" aria-hidden="true"></span>`;
      $(".icon", li).textContent = icon;
      if (href) {
        const a = document.createElement("a");
        a.href = href;
        a.textContent = label;
        if (href.startsWith("http")) {
          a.target = "_blank";
          a.rel = "noopener noreferrer";
        }
        li.append(a);
      } else {
        li.append(document.createTextNode(label));
      }
      list.append(li);
    };
    if (s.phone) add("📞", `${s.phone} · call`, `tel:${s.phone.replace(/\s/g, "")}`);
    const wa = whatsappUrl();
    if (wa) add("💬", "WhatsApp us", wa);
    if (facebookUrl()) add("📘", "Facebook: KX Nyalungu", facebookUrl());
    if (s.instagram) add("📸", `Instagram: ${s.instagram}`, `https://instagram.com/${s.instagram.replace(/^@/, "")}`);
    if (s.email) add("✉️", s.email, `mailto:${s.email}`);
    if (s.address) add("📍", s.address, `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address)}`);

    const table = $("[data-hours]");
    table.replaceChildren();
    const todayIndex = new Date().getDay();
    [1, 2, 3, 4, 5, 6, 0].forEach((weekday) => {
      const h = content.hours.find((x) => x.weekday === weekday);
      const tr = document.createElement("tr");
      if (weekday === todayIndex) tr.className = "today";
      tr.innerHTML = "<td></td><td></td>";
      tr.cells[0].textContent = DAY_NAMES[weekday];
      tr.cells[1].textContent = !h || h.closed ? "Closed" : `${h.open_time.slice(0, 5)} – ${h.close_time.slice(0, 5)}`;
      if (h?.max_bookings && !h.closed) {
        const spots = document.createElement("small");
        spots.className = "spots";
        spots.textContent = `${h.max_bookings} spots`;
        tr.cells[1].append(spots);
      }
      table.append(tr);
    });

    // School holiday hours: show the current or next holiday period.
    const note = $("[data-holiday-note]");
    const nextHoliday = (content.holidays ?? []).find((p) => p.ends_on >= toIso(new Date()));
    if (nextHoliday) {
      const isNow = nextHoliday.starts_on <= toIso(new Date());
      note.innerHTML = "<strong></strong><span></span>";
      $("strong", note).textContent = isNow ? "School holidays — now on" : "School holidays";
      $("span", note).textContent = ` ${shortDate(nextHoliday.starts_on)} – ${shortDate(nextHoliday.ends_on)}: open every day ${nextHoliday.open_time.slice(0, 5)} – ${nextHoliday.close_time.slice(0, 5)}`;
      note.hidden = false;
    } else {
      note.hidden = true;
    }
    if (!s.policies) $(".policies").hidden = true;
  }

  // ---------- Lightbox ----------

  const lightbox = $(".lightbox");
  function openLightbox(photo) {
    if (!photo.image_url || typeof lightbox.showModal !== "function") return;
    $("img", lightbox).src = photo.image_url;
    $("img", lightbox).alt = photo.caption || "Nail design";
    $(".lightbox-caption", lightbox).textContent = photo.caption || "";
    lightbox.showModal();
  }
  $(".lightbox-close").addEventListener("click", () => lightbox.close());
  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) lightbox.close();
  });

  // ---------- Booking ----------

  const form = $("[data-booking-form]");
  const serviceSelect = $("[data-service-select]");
  const submitButton = $("[data-submit-booking]");
  const statusEl = $(".form-status", form);
  const state = { date: null, time: null, totalCents: 0, depositCents: 0, requestId: 0 };

  function setStatus(message, kind = "") {
    statusEl.textContent = message;
    statusEl.dataset.state = kind;
  }

  function selectedAddonIds() {
    return $$("[data-addon-checks] input:checked").map((input) => input.value);
  }

  function currentSelection() {
    const service = content.services.find((s) => s.id === serviceSelect.value);
    if (!service) return null;
    const addons = content.addons.filter((a) => selectedAddonIds().includes(a.id));
    const houseCall = $("[data-housecall-check]").checked;
    const total =
      priceOf(service) + addons.reduce((sum, a) => sum + a.price_cents, 0) + (houseCall ? content.settings.house_call_fee_cents : 0);
    const duration = service.duration_minutes + addons.reduce((sum, a) => sum + a.duration_minutes, 0);
    const summary = [service.name, ...addons.map((a) => a.name), ...(houseCall ? ["House call"] : [])].join(" + ");
    return { service, addons, houseCall, total, duration, summary };
  }

  function setupBookingForm() {
    serviceSelect.innerHTML = `<option value="">Choose a service…</option>`;
    content.services.forEach((service) => {
      const option = document.createElement("option");
      option.value = service.id;
      option.textContent = `${service.name} — ${rand(priceOf(service))}`;
      serviceSelect.append(option);
    });

    const checks = $("[data-addon-checks]");
    checks.replaceChildren();
    content.addons.forEach((addon) => {
      const label = document.createElement("label");
      label.className = "check-chip";
      label.innerHTML = `<input type="checkbox" /><span></span>`;
      $("input", label).value = addon.id;
      $("span", label).textContent = `${addon.name} +${rand(addon.price_cents)}`;
      checks.append(label);
    });
    if (!content.addons.length) checks.closest(".field").hidden = true;

    renderDates();
    form.addEventListener("change", (event) => {
      if (event.target.matches("[data-housecall-check]")) {
        $("[data-address-field]").hidden = !event.target.checked;
      }
      if (event.target.matches("[data-service-select], [data-addon-checks] input, [data-housecall-check]")) {
        state.time = null;
        loadTimes();
      }
      updateSummary();
    });
    form.addEventListener("input", updateSummary);
    submitButton.addEventListener("click", submitBooking);
  }

  function selectService(serviceId) {
    serviceSelect.value = serviceId;
    serviceSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function isOpenDay(date) {
    return Boolean(rulesFor(toIso(date)));
  }

  function toIso(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function renderDates() {
    const strip = $("[data-dates]");
    strip.replaceChildren();
    const start = new Date();
    for (let i = 0; i < 30; i += 1) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "date-chip";
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", "false");
      button.dataset.date = toIso(date);
      button.innerHTML = `<span>${DAYS[date.getDay()]}</span><strong>${date.getDate()}</strong><span>${date.toLocaleDateString("en-ZA", { month: "short" })}</span>`;
      if (!isOpenDay(date)) {
        button.disabled = true;
        button.title = "Closed";
      }
      button.addEventListener("click", () => {
        $$(".date-chip", strip).forEach((b) => b.setAttribute("aria-selected", String(b === button)));
        state.date = button.dataset.date;
        state.time = null;
        loadTimes();
        updateSummary();
      });
      strip.append(button);
    }
  }

  // Demo mode: compute open times locally from the sample hours.
  function demoSlots(date, duration) {
    const hours = rulesFor(date);
    if (!hours) return [];
    const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const slots = [];
    const earliest = Date.now() + content.settings.booking_notice_hours * 3600_000;
    for (let t = toMin(hours.open_time); t + duration <= toMin(hours.close_time); t += content.settings.slot_interval_minutes) {
      const label = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
      if (new Date(`${date}T${label}:00`).getTime() >= earliest) slots.push(label);
    }
    return slots;
  }

  async function loadTimes() {
    const grid = $("[data-times]");
    const selection = currentSelection();
    grid.replaceChildren();
    if (!selection || !state.date) {
      grid.innerHTML = `<p>${!selection ? "Choose a service first, then pick a date." : "Pick a date to see open times."}</p>`;
      return;
    }
    grid.innerHTML = "<p>Checking open times…</p>";
    const requestId = ++state.requestId;
    try {
      const slots = live
        ? (await api("availability", {
            service_id: selection.service.id,
            addon_ids: selectedAddonIds(),
            house_call: selection.houseCall,
            date: state.date,
          })).slots
        : demoSlots(state.date, selection.duration);
      if (requestId !== state.requestId) return;
      grid.replaceChildren();
      if (!slots.length) {
        grid.innerHTML = "<p>This day is fully booked — please try another date.</p>";
        return;
      }
      const rules = rulesFor(state.date);
      if (rules?.max_bookings) {
        const note = document.createElement("p");
        note.textContent = `Only ${rules.max_bookings} bookings are available on this day — grab yours!`;
        grid.append(note);
      }
      slots.forEach((time) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "time-chip";
        button.textContent = time;
        button.setAttribute("aria-pressed", String(time === state.time));
        button.addEventListener("click", () => {
          state.time = time;
          $$(".time-chip", grid).forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
          updateSummary();
        });
        grid.append(button);
      });
    } catch (error) {
      grid.innerHTML = "";
      const p = document.createElement("p");
      p.textContent = error.message;
      grid.append(p);
    }
  }

  function updateSummary() {
    const selection = currentSelection();
    state.totalCents = selection?.total ?? 0;
    state.depositCents = selection ? depositFor(selection.total) : 0;
    $("[data-sum-service]").textContent = selection ? selection.summary : "—";
    $("[data-sum-when]").textContent =
      state.date && state.time
        ? `${new Date(`${state.date}T12:00:00`).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" })} · ${state.time}`
        : "—";
    $("[data-sum-total]").textContent = selection ? rand(state.totalCents) : "—";
    $("[data-sum-deposit]").textContent = selection ? rand(state.depositCents) : "—";
    submitButton.textContent = state.depositCents > 0 ? `Book & pay ${rand(state.depositCents)} deposit` : "Confirm booking";

    const name = form.elements.name.value.trim();
    const phone = form.elements.phone.value.trim();
    const addressOk = !selection?.houseCall || form.elements.address.value.trim().length >= 5;
    submitButton.disabled = !(selection && state.date && state.time && name && phone && addressOk && form.elements.consent.checked);
  }

  async function submitBooking() {
    const selection = currentSelection();
    if (!selection || !state.date || !state.time) return;
    if (!form.reportValidity()) return;

    const details = {
      service_id: selection.service.id,
      addon_ids: selectedAddonIds(),
      house_call: selection.houseCall,
      address: form.elements.address.value.trim(),
      date: state.date,
      time: state.time,
      name: form.elements.name.value.trim(),
      phone: form.elements.phone.value.trim(),
      email: form.elements.email.value.trim(),
      notes: form.elements.notes.value.trim(),
      consent: form.elements.consent.checked,
    };
    const whenText = `${state.date} at ${state.time}`;
    const message = `Hi KX Nyalungu Nails! I'd like to book: ${selection.summary} on ${whenText}. Name: ${details.name}. Total ${rand(selection.total)}, deposit ${rand(state.depositCents)}.${details.notes ? ` Notes: ${details.notes}` : ""}`;

    if (!live) {
      setStatus("Demo mode: online booking and payment switch on once the site is connected. You can send this booking on WhatsApp instead.", "success");
      const wa = whatsappUrl(message);
      if (wa) window.open(wa, "_blank", "noopener");
      return;
    }

    submitButton.disabled = true;
    setStatus("Reserving your time…");
    try {
      const result = await api("create_booking", details);
      if (result.payment) {
        setStatus("Taking you to secure payment…", "success");
        // Post the signed fields to PayFast.
        const payForm = document.createElement("form");
        payForm.method = "POST";
        payForm.action = result.payment.url;
        Object.entries(result.payment.fields).forEach(([key, value]) => {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = key;
          input.value = value;
          payForm.append(input);
        });
        document.body.append(payForm);
        payForm.submit();
        return;
      }
      showResult(result, selection, message);
    } catch (error) {
      setStatus(error.message, "error");
      if (/no longer available|just booked/i.test(error.message)) {
        state.time = null;
        loadTimes();
      }
      updateSummary();
    }
  }

  function showResult(result, selection, message) {
    const card = document.createElement("div");
    card.className = "result-card";
    const heading = document.createElement("h3");
    const text = document.createElement("p");
    if (result.status === "confirmed") {
      heading.textContent = "You're booked! 💅";
      text.textContent = `${selection.summary} on ${state.date} at ${state.time}. See you then!`;
    } else {
      heading.textContent = "Almost done — pay your deposit to secure the spot";
      text.textContent = `We've reserved ${selection.summary} on ${state.date} at ${state.time}. Pay the ${rand(state.depositCents)} deposit by EFT and send proof on WhatsApp.`;
      if (result.eft_details) {
        const eft = document.createElement("p");
        eft.textContent = result.eft_details;
        card.append(eft);
      }
    }
    card.prepend(heading, text);
    const wa = whatsappUrl(message);
    if (wa) {
      const link = document.createElement("a");
      link.className = "button button-pink";
      link.href = wa;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Send on WhatsApp";
      card.append(link);
    }
    form.replaceWith(card);
    $(".booking-summary").hidden = true;
  }

  // ---------- Navigation ----------

  function setupNav() {
    const toggle = $(".menu-toggle");
    const nav = $("#site-nav");
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(open));
      nav.classList.toggle("is-open", open);
    });
    nav.addEventListener("click", (event) => {
      if (event.target.closest("a")) {
        toggle.setAttribute("aria-expanded", "false");
        nav.classList.remove("is-open");
      }
    });
    $$("img[data-fallback]").forEach((img) => {
      img.addEventListener("error", () => {
        img.style.display = "none";
        img.parentElement.classList.add("img-fallback");
      });
      if (img.complete && img.naturalWidth === 0) img.dispatchEvent(new Event("error"));
    });
  }

  // ---------- Scroll animations ----------

  // Fades sections and cards up as they scroll into view, a little staggered within each row.
  // The classes are removed afterwards so hover effects keep their own quick timing.
  function setupReveal() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    const targets = $$(
      ".section-kicker, .section h2, .special-card, .menu-group, .addons-box, .gallery-grid figure, .about-photo, .about-copy, .step, .booking-summary, .contact-list li, .policies, .hours-card",
    ).filter((el) => !el.closest(".hero"));
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          el.classList.add("is-visible");
          observer.unobserve(el);
          setTimeout(() => {
            el.classList.remove("reveal", "is-visible");
            el.style.transitionDelay = "";
          }, 1200);
        });
      },
      { threshold: 0.12 },
    );
    targets.forEach((el) => {
      const siblings = [...el.parentElement.children].filter((c) => c.matches(el.tagName));
      el.style.transitionDelay = `${Math.min(siblings.indexOf(el), 5) * 90}ms`;
      el.classList.add("reveal");
      observer.observe(el);
    });
  }

  // The hero shows the two newest gallery photos, so new uploads appear at the top automatically.
  function renderHeroPhotos() {
    const photos = content.gallery.filter((p) => p.image_url);
    [".hero-card-front img", ".hero-card-back img"].forEach((selector, index) => {
      const img = $(selector);
      if (!img || !photos[index]) return;
      img.style.display = "";
      img.parentElement.classList.remove("img-fallback");
      img.src = photos[index].image_url;
      img.alt = photos[index].caption || "";
    });
  }

  // ---------- Start ----------

  async function start() {
    setupNav();
    if (!live) $(".demo-ribbon").hidden = false;
    try {
      content = await loadContent();
    } catch (error) {
      console.error("Falling back to demo content", error);
      content = { ...demo };
    }
    renderText();
    renderSpecials();
    renderMenu();
    renderGallery();
    renderHeroPhotos();
    renderAbout();
    renderVisit();
    setupBookingForm();
    updateSummary();
    loadTimes();
    setupReveal();
  }

  start();
})();
