// KX Nyalungu Nails — owner dashboard.
// Uses Supabase Auth to log the owner in; row-level security only lets users listed in
// public.admins change content or see bookings.
(() => {
  const cfg = window.KX_CONFIG ?? {};
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const rand = (cents) => `R${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function showView(name) {
    $$("[data-view]").forEach((view) => (view.hidden = view.dataset.view !== name));
    $("[data-logout]").hidden = name !== "dashboard";
  }

  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) {
    showView("setup");
    return;
  }

  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  let services = [];

  // ---------- Feedback ----------

  let toastTimer;
  function toast(message, isError = false) {
    const el = $(".toast");
    el.textContent = message;
    el.dataset.state = isError ? "error" : "";
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 3500);
  }

  async function run(promise, success) {
    const { error, data } = await promise;
    if (error) {
      toast(error.message, true);
      throw error;
    }
    if (success) toast(success);
    return data;
  }

  // ---------- Auth ----------

  async function enterDashboard(user) {
    const { data } = await sb.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!data) {
      await sb.auth.signOut();
      showView("login");
      const status = $("[data-login-form] .form-status");
      status.textContent = "This account isn't set up as the owner. See README.md, step 5.";
      status.dataset.state = "error";
      return;
    }
    showView("dashboard");
    await loadServices();
    openTab("bookings");
  }

  $("[data-login-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = $(".form-status", form);
    status.textContent = "Logging in…";
    status.dataset.state = "";
    const { data, error } = await sb.auth.signInWithPassword({
      email: form.elements.email.value.trim(),
      password: form.elements.password.value,
    });
    if (error) {
      status.textContent = error.message;
      status.dataset.state = "error";
      return;
    }
    status.textContent = "";
    enterDashboard(data.user);
  });

  $("[data-logout]").addEventListener("click", async () => {
    await sb.auth.signOut();
    showView("login");
  });

  // ---------- Tabs ----------

  const loaders = {
    bookings: loadBookings,
    specials: loadSpecials,
    prices: loadPrices,
    gallery: loadGallery,
    hours: loadHours,
    settings: loadSettings,
  };

  function openTab(name) {
    $$("[data-tab]").forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.tab === name)));
    $$("[data-panel]").forEach((panel) => (panel.hidden = panel.dataset.panel !== name));
    loaders[name]?.();
  }
  $$("[data-tab]").forEach((tab) => tab.addEventListener("click", () => openTab(tab.dataset.tab)));

  // ---------- Generic edit dialog ----------

  const dialog = $(".edit-dialog");
  function editDialog(title, fields) {
    $("[data-edit-title]").textContent = title;
    const container = $("[data-edit-fields]");
    container.replaceChildren();
    fields.forEach((field) => {
      const label = document.createElement("label");
      label.className = field.type === "checkbox" ? "toggle" : "field";
      let input;
      if (field.type === "textarea") {
        input = document.createElement("textarea");
        input.rows = 3;
      } else if (field.type === "select") {
        input = document.createElement("select");
        field.options.forEach(([value, text]) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = text;
          input.append(option);
        });
      } else {
        input = document.createElement("input");
        input.type = field.type ?? "text";
        if (field.step) input.step = field.step;
        if (field.min != null) input.min = field.min;
        if (field.accept) input.accept = field.accept;
      }
      input.name = field.name;
      if (field.required) input.required = true;
      if (field.maxLength) input.maxLength = field.maxLength;
      if (field.type === "checkbox") input.checked = Boolean(field.value);
      else if (field.type !== "file") input.value = field.value ?? "";
      const span = document.createElement("span");
      span.textContent = field.label;
      if (field.type === "checkbox") label.append(input, span);
      else label.append(span, input);
      container.append(label);
    });

    return new Promise((resolve) => {
      const form = $("[data-edit-form]");
      const onSubmit = (event) => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        const values = {};
        fields.forEach((field) => {
          const input = form.elements[field.name];
          values[field.name] =
            field.type === "checkbox" ? input.checked : field.type === "file" ? input.files[0] ?? null : input.value.trim();
        });
        cleanup();
        dialog.close();
        resolve(values);
      };
      const onCancel = () => {
        cleanup();
        dialog.close();
        resolve(null);
      };
      const cleanup = () => {
        form.removeEventListener("submit", onSubmit);
        $("[data-edit-cancel]").removeEventListener("click", onCancel);
      };
      form.addEventListener("submit", onSubmit);
      $("[data-edit-cancel]").addEventListener("click", onCancel);
      dialog.showModal();
    });
  }

  function row({ title, meta, pill, inactive, actions }) {
    const el = document.createElement("div");
    el.className = `row${inactive ? " inactive" : ""}`;
    const info = document.createElement("div");
    const t = document.createElement("div");
    t.className = "row-title";
    t.textContent = title;
    if (pill) {
      const p = document.createElement("span");
      p.className = `pill pill-${pill}`;
      p.textContent = pill.replace("_", " ");
      t.append(" ", p);
    }
    const m = document.createElement("div");
    m.className = "row-meta";
    m.textContent = meta;
    info.append(t, m);
    const buttons = document.createElement("div");
    buttons.className = "row-actions";
    actions.forEach(([label, handler, style]) => {
      const b = document.createElement(typeof handler === "string" ? "a" : "button");
      b.className = `button ${style ?? "button-ghost"}`;
      b.textContent = label;
      if (typeof handler === "string") {
        b.href = handler;
        b.target = "_blank";
        b.rel = "noopener";
      } else {
        b.type = "button";
        b.addEventListener("click", handler);
      }
      buttons.append(b);
    });
    el.append(info, buttons);
    return el;
  }

  function empty(text) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = text;
    return p;
  }

  async function uploadImage(file, folder) {
    if (file.size > 8 * 1024 * 1024) throw new Error("Please choose a photo under 8 MB.");
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${folder}/${crypto.randomUUID()}.${ext}`;
    await run(sb.storage.from("media").upload(path, file, { cacheControl: "31536000", upsert: false }));
    return sb.storage.from("media").getPublicUrl(path).data.publicUrl;
  }

  async function removeStoredImage(url) {
    const marker = "/storage/v1/object/public/media/";
    const index = url.indexOf(marker);
    if (index >= 0) await sb.storage.from("media").remove([url.slice(index + marker.length)]);
  }

  // ---------- Bookings ----------

  $("[data-booking-filter]").addEventListener("change", loadBookings);

  async function loadBookings() {
    const filter = $("[data-booking-filter]").value;
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday.getTime() + 86400000);
    let query = sb.from("bookings").select("*");
    if (filter === "upcoming") query = query.gte("starts_at", now.toISOString()).order("starts_at");
    if (filter === "today") query = query.gte("starts_at", startOfToday.toISOString()).lt("starts_at", endOfToday.toISOString()).order("starts_at");
    if (filter === "past") query = query.lt("starts_at", now.toISOString()).order("starts_at", { ascending: false });
    if (filter === "all") query = query.order("starts_at", { ascending: false });
    const bookings = await run(query.limit(200));

    // Stats for the current month.
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const { data: month } = await sb.from("bookings").select("status, paid_cents, total_cents, starts_at").gte("starts_at", monthStart);
    const active = (month ?? []).filter((b) => ["confirmed", "completed"].includes(b.status));
    const stats = [
      [active.filter((b) => new Date(b.starts_at) >= startOfToday && new Date(b.starts_at) < endOfToday).length, "today"],
      [active.length, "bookings this month"],
      [(month ?? []).filter((b) => b.status === "requested").length, "awaiting EFT deposit"],
      [rand(active.reduce((sum, b) => sum + b.paid_cents, 0)), "deposits paid this month"],
    ];
    const statRow = $("[data-booking-stats]");
    statRow.replaceChildren(
      ...stats.map(([value, label]) => {
        const div = document.createElement("div");
        div.className = "stat";
        div.innerHTML = "<strong></strong><span></span>";
        $("strong", div).textContent = value;
        $("span", div).textContent = label;
        return div;
      }),
    );

    const list = $("[data-bookings]");
    list.replaceChildren();
    const visible = bookings.filter((b) => filter === "all" || b.status !== "expired");
    if (!visible.length) list.append(empty("No bookings here yet."));
    visible.forEach((b) => {
      const when = new Date(b.starts_at).toLocaleString("en-ZA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      const meta = [
        when,
        `${b.client_name} · ${b.client_phone}`,
        `Total ${rand(b.total_cents)} · paid ${rand(b.paid_cents)}`,
        b.house_call ? `🏠 ${b.house_call_address}` : "",
        b.notes ? `📝 ${b.notes}` : "",
      ].filter(Boolean).join("  ·  ");
      const phone = b.client_phone.replace(/\D/g, "").replace(/^0/, "27");
      const actions = [["WhatsApp", `https://wa.me/${phone}?text=${encodeURIComponent(`Hi ${b.client_name}, this is KX Nyalungu Nails about your booking on ${when}.`)}`]];
      if (b.status === "requested") {
        actions.push(["Deposit received", () => updateBooking(b.id, { status: "confirmed", paid_cents: b.deposit_cents }, "Booking confirmed"), "button-pink"]);
      }
      if (["confirmed"].includes(b.status) && new Date(b.starts_at) < new Date()) {
        actions.push(["Mark done", () => updateBooking(b.id, { status: "completed" }, "Marked as done")]);
      }
      if (["confirmed", "requested", "pending_payment"].includes(b.status)) {
        actions.push(["Cancel", () => {
          if (confirm(`Cancel ${b.client_name}'s booking on ${when}? Remember to refund any deposit if needed.`)) {
            updateBooking(b.id, { status: "cancelled" }, "Booking cancelled");
          }
        }]);
      }
      list.append(row({ title: b.summary, meta, pill: b.status, actions }));
    });
  }

  async function updateBooking(id, changes, message) {
    await run(sb.from("bookings").update(changes).eq("id", id), message);
    loadBookings();
  }

  // ---------- Services & add-ons ----------

  async function loadServices() {
    services = await run(sb.from("services").select("*").order("sort"));
  }

  async function loadPrices() {
    await loadServices();
    const list = $("[data-services]");
    list.replaceChildren();
    if (!services.length) list.append(empty("No services yet."));
    services.forEach((s) => {
      list.append(row({
        title: `${s.name} — ${rand(s.price_cents)}`,
        meta: `${s.category || "No category"} · ${s.duration_minutes} min${s.active ? "" : " · hidden"}`,
        inactive: !s.active,
        actions: [
          ["Edit", () => editService(s)],
          [s.active ? "Hide" : "Show", () => run(sb.from("services").update({ active: !s.active }).eq("id", s.id), "Saved").then(loadPrices)],
        ],
      }));
    });

    const addons = await run(sb.from("addons").select("*").order("sort"));
    const addonList = $("[data-addons]");
    addonList.replaceChildren();
    if (!addons.length) addonList.append(empty("No add-ons yet."));
    addons.forEach((a) => {
      addonList.append(row({
        title: `${a.name} — +${rand(a.price_cents)}`,
        meta: `adds ${a.duration_minutes} min${a.active ? "" : " · hidden"}`,
        inactive: !a.active,
        actions: [
          ["Edit", () => editAddon(a)],
          [a.active ? "Hide" : "Show", () => run(sb.from("addons").update({ active: !a.active }).eq("id", a.id), "Saved").then(loadPrices)],
          ["Delete", () => confirm(`Delete ${a.name}?`) && run(sb.from("addons").delete().eq("id", a.id), "Deleted").then(loadPrices)],
        ],
      }));
    });
  }

  async function editService(service = {}) {
    const values = await editDialog(service.id ? "Edit service" : "New service", [
      { name: "name", label: "Name", required: true, maxLength: 120, value: service.name },
      { name: "category", label: "Category (e.g. Acrylic mani, Gel, Pedicure)", maxLength: 60, value: service.category },
      { name: "description", label: "Short description", type: "textarea", value: service.description },
      { name: "price", label: "Price (R)", type: "number", step: "1", min: 0, required: true, value: service.price_cents != null ? service.price_cents / 100 : "" },
      { name: "duration_minutes", label: "How long it takes (minutes)", type: "number", min: 5, required: true, value: service.duration_minutes ?? 60 },
      { name: "sort", label: "Order on the price list (1 = first)", type: "number", value: service.sort ?? services.length + 1 },
    ]);
    if (!values) return;
    const record = {
      name: values.name,
      category: values.category,
      description: values.description,
      price_cents: Math.round(Number(values.price) * 100),
      duration_minutes: Number(values.duration_minutes),
      sort: Number(values.sort) || 0,
    };
    await run(service.id ? sb.from("services").update(record).eq("id", service.id) : sb.from("services").insert(record), "Service saved");
    loadPrices();
  }

  async function editAddon(addon = {}) {
    const values = await editDialog(addon.id ? "Edit add-on" : "New add-on", [
      { name: "name", label: "Name (e.g. Chrome)", required: true, maxLength: 80, value: addon.name },
      { name: "price", label: "Extra price (R)", type: "number", min: 0, required: true, value: addon.price_cents != null ? addon.price_cents / 100 : "" },
      { name: "duration_minutes", label: "Extra time (minutes)", type: "number", min: 0, value: addon.duration_minutes ?? 10 },
      { name: "sort", label: "Order", type: "number", value: addon.sort ?? 0 },
    ]);
    if (!values) return;
    const record = {
      name: values.name,
      price_cents: Math.round(Number(values.price) * 100),
      duration_minutes: Number(values.duration_minutes) || 0,
      sort: Number(values.sort) || 0,
    };
    await run(addon.id ? sb.from("addons").update(record).eq("id", addon.id) : sb.from("addons").insert(record), "Add-on saved");
    loadPrices();
  }

  // ---------- Specials ----------

  async function loadSpecials() {
    await loadServices();
    const specials = await run(sb.from("specials").select("*").order("starts_on", { ascending: false }));
    const list = $("[data-specials]");
    list.replaceChildren();
    if (!specials.length) list.append(empty("No specials yet — tap “New special” to post one."));
    const today = new Date().toISOString().slice(0, 10);
    specials.forEach((sp) => {
      const live = sp.active && sp.starts_on <= today && sp.ends_on >= today;
      const service = services.find((s) => s.id === sp.service_id);
      list.append(row({
        title: sp.title,
        meta: `${sp.starts_on} → ${sp.ends_on}${service ? ` · ${service.name}` : ""}${sp.special_price_cents != null ? ` · ${rand(sp.special_price_cents)}` : ""}`,
        pill: live ? "confirmed" : sp.ends_on < today ? "expired" : "requested",
        inactive: !sp.active,
        actions: [
          ["Edit", () => editSpecial(sp)],
          [sp.active ? "Pause" : "Activate", () => run(sb.from("specials").update({ active: !sp.active }).eq("id", sp.id), "Saved").then(loadSpecials)],
          ["Delete", async () => {
            if (!confirm(`Delete "${sp.title}"?`)) return;
            await run(sb.from("specials").delete().eq("id", sp.id), "Special deleted");
            if (sp.image_url) removeStoredImage(sp.image_url);
            loadSpecials();
          }],
        ],
      }));
    });
    // Status pill labels for specials read more naturally like this:
    $$("[data-specials] .pill").forEach((pill) => {
      pill.textContent = { confirmed: "live", expired: "ended", requested: "scheduled" }[pill.classList[1].replace("pill-", "")] ?? pill.textContent;
    });
  }

  async function editSpecial(special = {}) {
    const today = new Date().toISOString().slice(0, 10);
    const inAWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const values = await editDialog(special.id ? "Edit special" : "New special", [
      { name: "title", label: "Title (e.g. Chrome Week)", required: true, maxLength: 120, value: special.title },
      { name: "description", label: "Description", type: "textarea", value: special.description },
      { name: "badge", label: "Badge (e.g. R120, 20% OFF)", maxLength: 20, value: special.badge },
      { name: "service_id", label: "Linked service (optional)", type: "select", options: [["", "— none —"], ...services.map((s) => [s.id, `${s.name} (${rand(s.price_cents)})`])], value: special.service_id ?? "" },
      { name: "special_price", label: "Special price for that service (R, optional)", type: "number", min: 0, value: special.special_price_cents != null ? special.special_price_cents / 100 : "" },
      { name: "starts_on", label: "Starts", type: "date", required: true, value: special.starts_on ?? today },
      { name: "ends_on", label: "Ends", type: "date", required: true, value: special.ends_on ?? inAWeek },
      { name: "image", label: special.image_url ? "Replace photo (optional)" : "Photo (optional)", type: "file", accept: "image/*" },
    ]);
    if (!values) return;
    if (values.ends_on < values.starts_on) return toast("The end date must be after the start date.", true);
    const record = {
      title: values.title,
      description: values.description,
      badge: values.badge,
      service_id: values.service_id || null,
      special_price_cents: values.special_price === "" ? null : Math.round(Number(values.special_price) * 100),
      starts_on: values.starts_on,
      ends_on: values.ends_on,
    };
    try {
      if (values.image) {
        record.image_url = await uploadImage(values.image, "specials");
        if (special.image_url) removeStoredImage(special.image_url);
      }
      await run(special.id ? sb.from("specials").update(record).eq("id", special.id) : sb.from("specials").insert(record), "Special saved — it's on your website");
    } catch (error) {
      toast(error.message, true);
    }
    loadSpecials();
  }

  // ---------- Gallery ----------

  async function loadGallery() {
    const photos = await run(sb.from("gallery").select("*").order("sort").order("created_at", { ascending: false }));
    const grid = $("[data-gallery]");
    grid.replaceChildren();
    if (!photos.length) grid.append(empty("No photos yet — upload your best sets!"));
    photos.forEach((photo) => {
      const card = document.createElement("div");
      card.className = "admin-photo";
      card.innerHTML = `<img alt="" loading="lazy" /><div class="admin-photo-body"><input maxlength="120" placeholder="Caption" /><button class="button button-ghost" type="button">Delete</button></div>`;
      $("img", card).src = photo.image_url;
      $("img", card).alt = photo.caption;
      const input = $("input", card);
      input.value = photo.caption;
      input.addEventListener("change", () => run(sb.from("gallery").update({ caption: input.value.trim() }).eq("id", photo.id), "Caption saved"));
      $("button", card).addEventListener("click", async () => {
        if (!confirm("Delete this photo?")) return;
        await run(sb.from("gallery").delete().eq("id", photo.id), "Photo deleted");
        removeStoredImage(photo.image_url);
        loadGallery();
      });
      grid.append(card);
    });
  }

  $("[data-gallery-upload]").addEventListener("change", async (event) => {
    const files = [...event.target.files];
    event.target.value = "";
    for (const file of files) {
      try {
        toast(`Uploading ${file.name}…`);
        const url = await uploadImage(file, "gallery");
        await run(sb.from("gallery").insert({ image_url: url, caption: "" }));
      } catch (error) {
        toast(error.message, true);
      }
    }
    toast("Photos added to your gallery");
    loadGallery();
  });

  // ---------- Hours & days off ----------

  async function loadHours() {
    const hours = await run(sb.from("business_hours").select("*").order("weekday"));
    const container = $("[data-hours]");
    container.replaceChildren();
    [1, 2, 3, 4, 5, 6, 0].forEach((weekday) => {
      const h = hours.find((x) => x.weekday === weekday) ?? { weekday, closed: true };
      const div = document.createElement("div");
      div.className = "hours-row";
      div.dataset.weekday = weekday;
      div.innerHTML = `<strong></strong><label class="toggle"><input type="checkbox" data-closed /><span>Closed</span></label>
        <input type="time" data-open /><input type="time" data-close />`;
      $("strong", div).textContent = DAY_NAMES[weekday];
      $("[data-closed]", div).checked = h.closed;
      $("[data-open]", div).value = h.open_time?.slice(0, 5) ?? "09:00";
      $("[data-close]", div).value = h.close_time?.slice(0, 5) ?? "17:00";
      container.append(div);
    });
    loadBlocked();
  }

  $("[data-hours-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const rows = $$(".hours-row").map((div) => {
      const closed = $("[data-closed]", div).checked;
      return {
        weekday: Number(div.dataset.weekday),
        closed,
        open_time: closed ? null : $("[data-open]", div).value,
        close_time: closed ? null : $("[data-close]", div).value,
      };
    });
    const bad = rows.find((r) => !r.closed && (!r.open_time || !r.close_time || r.close_time <= r.open_time));
    if (bad) return toast(`Check ${DAY_NAMES[bad.weekday]}: closing time must be after opening time.`, true);
    await run(sb.from("business_hours").upsert(rows), "Hours saved");
  });

  async function loadBlocked() {
    const today = new Date().toISOString().slice(0, 10);
    const days = await run(sb.from("blocked_dates").select("*").gte("day", today).order("day"));
    const list = $("[data-blocked]");
    list.replaceChildren();
    if (!days.length) list.append(empty("No days off planned."));
    days.forEach((d) => {
      list.append(row({
        title: new Date(`${d.day}T12:00:00`).toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" }),
        meta: d.reason || "Day off",
        actions: [["Remove", () => run(sb.from("blocked_dates").delete().eq("day", d.day), "Removed").then(loadBlocked)]],
      }));
    });
  }

  $("[data-blocked-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    await run(sb.from("blocked_dates").upsert({ day: form.elements.day.value, reason: form.elements.reason.value.trim() }), "Date blocked");
    form.reset();
    loadBlocked();
  });

  // ---------- Settings ----------

  const settingsForm = $("[data-settings-form]");
  let currentOwnerPhoto = "";

  // Relative paths (like images/owner.jpg) live on the website, one folder up from /admin.
  const sitePath = (url) => (url && !/^https?:\/\//.test(url) ? `../${url}` : url);

  async function loadSettings() {
    const s = await run(sb.from("settings").select("*").eq("id", 1).single());
    for (const element of settingsForm.elements) {
      if (!element.name || element.type === "file") continue;
      if (element.name === "house_call_fee") element.value = s.house_call_fee_cents / 100;
      else if (element.name in s) element.value = s[element.name] ?? "";
    }
    currentOwnerPhoto = s.owner_photo_url;
    $("[data-owner-preview]").src = sitePath(s.owner_photo_url);
  }

  settingsForm.elements.owner_photo.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) $("[data-owner-preview]").src = URL.createObjectURL(file);
  });

  settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const f = settingsForm.elements;
    const record = {
      tagline: f.tagline.value.trim(),
      about: f.about.value.trim(),
      phone: f.phone.value.trim(),
      whatsapp: f.whatsapp.value.replace(/\D/g, ""),
      facebook: f.facebook.value.trim(),
      instagram: f.instagram.value.trim(),
      email: f.email.value.trim(),
      address: f.address.value.trim(),
      deposit_type: f.deposit_type.value,
      deposit_value: Number(f.deposit_value.value) || 0,
      house_call_fee_cents: Math.round(Number(f.house_call_fee.value || 0) * 100),
      slot_interval_minutes: Number(f.slot_interval_minutes.value) || 30,
      booking_notice_hours: Number(f.booking_notice_hours.value) || 0,
      owner_notification_email: f.owner_notification_email.value.trim(),
      eft_details: f.eft_details.value.trim(),
      policies: f.policies.value.trim(),
      owner_name: f.owner_name.value.trim(),
      owner_bio: f.owner_bio.value.trim(),
      updated_at: new Date().toISOString(),
    };
    if (record.deposit_type === "percent" && record.deposit_value > 100) return toast("A percentage deposit can't be more than 100%.", true);
    try {
      const photo = f.owner_photo.files[0];
      if (photo) {
        record.owner_photo_url = await uploadImage(photo, "owner");
        if (currentOwnerPhoto) removeStoredImage(currentOwnerPhoto);
        currentOwnerPhoto = record.owner_photo_url;
        f.owner_photo.value = "";
      }
      await run(sb.from("settings").update(record).eq("id", 1), "Settings saved");
    } catch (error) {
      toast(error.message, true);
    }
  });

  // "New" buttons
  $$("[data-new]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.new === "special") editSpecial();
      if (button.dataset.new === "service") editService();
      if (button.dataset.new === "addon") editAddon();
    });
  });

  // ---------- Start ----------

  sb.auth.getSession().then(({ data }) => {
    if (data.session) enterDashboard(data.session.user);
    else showView("login");
  });
})();
