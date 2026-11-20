// KX Nyalungu Nails — public API (Supabase Edge Function).
// Actions: "availability", "create_booking", "booking_status".
// Secrets are read from Edge Function secrets; nothing secret is sent to the browser.
import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { centsToRand, payfastConfigured, payfastHost, signature } from "../_shared/payfast.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

// South Africa has no daylight saving, so a fixed offset is exact.
const TZ_OFFSET = "+02:00";
const PENDING_PAYMENT_MINUTES = 30;

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function rateLimit(request: Request, scope: string, limit: number, windowSeconds: number) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? request.headers.get("cf-connecting-ip") ?? "unknown";
  const bucket = await sha256Hex(`${Deno.env.get("RATE_LIMIT_SALT") ?? ""}:${scope}:${ip}`);
  const { data, error } = await db.rpc("consume_rate_limit", {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) throw new Error(`Rate limit check failed: ${error.message}`);
  if (data !== true) throw new HttpError(429, "Too many requests — please try again in a few minutes.");
}

// ---------- Business data ----------

type Settings = {
  business_name: string;
  tagline: string;
  about: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  facebook: string;
  instagram: string;
  deposit_type: "percent" | "fixed" | "none";
  deposit_value: number;
  house_call_fee_cents: number;
  slot_interval_minutes: number;
  booking_notice_hours: number;
  eft_details: string;
  policies: string;
  owner_notification_email: string;
  owner_name: string;
  owner_bio: string;
};

async function loadSettings(): Promise<Settings> {
  const { data, error } = await db.from("settings").select("*").eq("id", 1).single();
  if (error) throw new Error(`Settings unavailable: ${error.message}`);
  return data as Settings;
}

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === value;
}

function todayInSA(): string {
  return new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 10);
}

async function expireStalePayments() {
  const cutoff = new Date(Date.now() - PENDING_PAYMENT_MINUTES * 60_000).toISOString();
  await db.from("bookings").update({ status: "expired" }).eq("status", "pending_payment").lt("created_at", cutoff);
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
};
const hhmm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

type DayRules = { open_time: string; close_time: string; max_bookings: number | null };

// Working hours for a date: a holiday period (e.g. school holidays) overrides the weekly hours.
async function rulesForDate(date: string): Promise<DayRules | null> {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const [{ data: holiday }, { data: hours }, { data: blocked }] = await Promise.all([
    db.from("holiday_periods").select("open_time, close_time, max_bookings")
      .lte("starts_on", date).gte("ends_on", date).limit(1).maybeSingle(),
    db.from("business_hours").select("*").eq("weekday", weekday).maybeSingle(),
    db.from("blocked_dates").select("day").eq("day", date).maybeSingle(),
  ]);
  if (blocked) return null;
  if (holiday) return holiday;
  if (!hours || hours.closed) return null;
  return hours;
}

const ACTIVE_STATUSES = ["pending_payment", "requested", "confirmed"];

async function bookingsOn(date: string) {
  const dayStart = `${date}T00:00:00${TZ_OFFSET}`;
  const dayEnd = `${date}T23:59:59${TZ_OFFSET}`;
  const { data, error } = await db
    .from("bookings")
    .select("id, starts_at, ends_at, created_at")
    .in("status", ACTIVE_STATUSES)
    .lt("starts_at", dayEnd)
    .gt("ends_at", dayStart);
  if (error) throw new Error(`Bookings unavailable: ${error.message}`);
  return data ?? [];
}

type Slot = { time: string; end: string; available: boolean };

// The day's fixed appointment slots. Every appointment takes one slot of `slot_interval_minutes`
// (2 hours by default), whatever the service. Slots start every slot length from opening time;
// the last one may start any time before closing. Booked slots stay listed as unavailable so
// clients can see they're taken.
async function daySlots(date: string, settings: Settings): Promise<Slot[]> {
  if (date < todayInSA()) return [];
  const rules = await rulesForDate(date);
  if (!rules) return [];

  await expireStalePayments();
  const bookings = await bookingsOn(date);
  // Daily limit (e.g. only 2 bookings on weekdays): once reached, nothing else can be booked.
  const dayFull = rules.max_bookings != null && bookings.length >= rules.max_bookings;

  const busy = bookings.map((b) => [new Date(b.starts_at).getTime(), new Date(b.ends_at).getTime()]);
  const earliest = Date.now() + settings.booking_notice_hours * 3600_000;
  const length = settings.slot_interval_minutes;
  const slots: Slot[] = [];

  for (let t = minutes(rules.open_time); t < minutes(rules.close_time); t += length) {
    const start = new Date(`${date}T${hhmm(t)}:00${TZ_OFFSET}`).getTime();
    if (start < earliest) continue; // already started or too soon to book
    const end = start + length * 60_000;
    const taken = busy.some(([bs, be]) => start < be && end > bs);
    slots.push({ time: hhmm(t), end: hhmm(t + length), available: !taken && !dayFull });
  }
  return slots;
}

type Selection = {
  serviceId: string;
  serviceName: string;
  durationMinutes: number;
  totalCents: number;
  summary: string;
};

// Works out what the client is booking and its price, using any current special price.
async function priceSelection(serviceId: unknown, addonIds: unknown, houseCall: boolean, settings: Settings): Promise<Selection> {
  if (typeof serviceId !== "string" || !/^[0-9a-f-]{36}$/.test(serviceId)) throw new HttpError(400, "Choose a service.");
  const ids = Array.isArray(addonIds) ? addonIds.filter((id) => typeof id === "string" && /^[0-9a-f-]{36}$/.test(id)) : [];

  const { data: service } = await db.from("services").select("*").eq("id", serviceId).eq("active", true).maybeSingle();
  if (!service) throw new HttpError(400, "That service is no longer available.");

  const { data: addons } = ids.length
    ? await db.from("addons").select("*").in("id", ids).eq("active", true)
    : { data: [] as { name: string; price_cents: number; duration_minutes: number }[] };

  const today = todayInSA();
  const { data: special } = await db
    .from("specials")
    .select("special_price_cents")
    .eq("service_id", serviceId)
    .eq("active", true)
    .lte("starts_on", today)
    .gte("ends_on", today)
    .not("special_price_cents", "is", null)
    .order("special_price_cents", { ascending: true })
    .limit(1)
    .maybeSingle();

  const basePrice = special?.special_price_cents ?? service.price_cents;
  const addonList = addons ?? [];
  const totalCents =
    basePrice +
    addonList.reduce((sum, a) => sum + a.price_cents, 0) +
    (houseCall ? settings.house_call_fee_cents : 0);
  const durationMinutes = service.duration_minutes + addonList.reduce((sum, a) => sum + a.duration_minutes, 0);
  const summary = [service.name, ...addonList.map((a) => a.name), ...(houseCall ? ["House call"] : [])].join(" + ");

  return { serviceId, serviceName: service.name, durationMinutes, totalCents, summary };
}

function depositFor(totalCents: number, settings: Settings): number {
  if (settings.deposit_type === "none") return 0;
  if (settings.deposit_type === "fixed") return Math.min(settings.deposit_value * 100, totalCents);
  return Math.round((totalCents * Math.min(settings.deposit_value, 100)) / 100);
}

async function notifyOwner(settings: Settings, subject: string, lines: string[]) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM");
  if (!apiKey || !from || !settings.owner_notification_email) return;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [settings.owner_notification_email], subject, text: lines.join("\n") }),
  });
  if (!response.ok) console.error("Owner email failed", response.status);
}

// ---------- Actions ----------

async function handleAvailability(body: Record<string, unknown>) {
  if (!isValidDate(body.date)) throw new HttpError(400, "Choose a valid date.");
  const settings = await loadSettings();
  const selection = await priceSelection(body.service_id, body.addon_ids, body.house_call === true, settings);
  const slots = await daySlots(body.date, settings);
  return json(200, {
    slots,
    total_cents: selection.totalCents,
    deposit_cents: depositFor(selection.totalCents, settings),
    duration_minutes: settings.slot_interval_minutes,
  });
}

async function handleCreateBooking(request: Request, body: Record<string, unknown>) {
  await rateLimit(request, "booking", 5, 3600);

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 1000) : "";
  const houseCall = body.house_call === true;
  const address = typeof body.address === "string" ? body.address.trim().slice(0, 300) : "";
  if (name.length < 2 || name.length > 120) throw new HttpError(400, "Please enter your name.");
  if (!/^[0-9+()\s-]{9,30}$/.test(phone)) throw new HttpError(400, "Please enter a valid phone number.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Please enter a valid email.");
  if (houseCall && address.length < 5) throw new HttpError(400, "Please enter the address for your house call.");
  if (!isValidDate(body.date) || typeof body.time !== "string" || !/^\d{2}:\d{2}$/.test(body.time)) {
    throw new HttpError(400, "Choose a date and time.");
  }
  if (body.consent !== true) throw new HttpError(400, "Please accept the booking policy.");

  const settings = await loadSettings();
  const selection = await priceSelection(body.service_id, body.addon_ids, houseCall, settings);
  const slots = await daySlots(body.date, settings);
  if (!slots.some((slot) => slot.time === body.time && slot.available)) {
    throw new HttpError(409, "Sorry, that time is no longer available. Please pick another.");
  }

  const deposit = depositFor(selection.totalCents, settings);
  const onlinePayment = deposit > 0 && payfastConfigured();
  const status = deposit === 0 ? "confirmed" : onlinePayment ? "pending_payment" : "requested";
  const startsAt = new Date(`${body.date}T${body.time}:00${TZ_OFFSET}`);
  const endsAt = new Date(startsAt.getTime() + settings.slot_interval_minutes * 60_000);
  const token = randomToken();

  const { data: booking, error } = await db
    .from("bookings")
    .insert({
      service_id: selection.serviceId,
      summary: selection.summary,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      client_name: name,
      client_phone: phone,
      client_email: email,
      notes,
      house_call: houseCall,
      house_call_address: houseCall ? address : "",
      total_cents: selection.totalCents,
      deposit_cents: deposit,
      status,
      lookup_token_hash: await sha256Hex(token),
    })
    .select("id")
    .single();

  if (error) {
    // 23P01: exclusion violation — someone booked an overlapping slot a moment earlier.
    if (error.code === "23P01") throw new HttpError(409, "Sorry, that time was just booked. Please pick another.");
    throw new Error(`Booking insert failed: ${error.message}`);
  }

  // Two clients booking the last spot at the same moment could both get through the slot
  // check; if the day is now over its limit, the later booking backs out.
  const rules = await rulesForDate(body.date);
  if (rules?.max_bookings != null) {
    // Keep the earliest bookings of the day (by creation time); any beyond the limit back out.
    const sameDay = (await bookingsOn(body.date)).sort(
      (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
    );
    if (sameDay.findIndex((b) => b.id === booking.id) >= rules.max_bookings) {
      await db.from("bookings").delete().eq("id", booking.id);
      throw new HttpError(409, "Sorry, that day just filled up. Please pick another date.");
    }
  }

  const when = `${body.date} at ${body.time}`;
  if (status !== "pending_payment") {
    await notifyOwner(settings, `New booking: ${selection.summary} — ${when}`, [
      `Client: ${name} (${phone}${email ? `, ${email}` : ""})`,
      `Booking: ${selection.summary}`,
      `When: ${when}`,
      `Total: R${centsToRand(selection.totalCents)} · Deposit: R${centsToRand(deposit)} (${status === "requested" ? "to be paid by EFT" : "none"})`,
      houseCall ? `House call address: ${address}` : "",
      notes ? `Notes: ${notes}` : "",
    ]);
  }

  const result: Record<string, unknown> = { booking_id: booking.id, token, status };

  if (onlinePayment) {
    const siteUrl = (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");
    const statusUrl = `${siteUrl}/booking.html?b=${booking.id}&t=${token}`;
    const [firstName, ...rest] = name.split(/\s+/);
    // Field order matters for the PayFast signature.
    const fields: [string, string][] = [
      ["merchant_id", Deno.env.get("PAYFAST_MERCHANT_ID")!],
      ["merchant_key", Deno.env.get("PAYFAST_MERCHANT_KEY")!],
      ["return_url", statusUrl],
      ["cancel_url", `${statusUrl}&cancelled=1`],
      ["notify_url", `${Deno.env.get("SUPABASE_URL")}/functions/v1/payfast-itn`],
      ["name_first", firstName.slice(0, 100)],
      ["name_last", rest.join(" ").slice(0, 100)],
      ["email_address", email],
      ["m_payment_id", booking.id],
      ["amount", centsToRand(deposit)],
      ["item_name", `Deposit: ${selection.summary}`.slice(0, 100)],
      ["item_description", `Appointment ${when}`.slice(0, 255)],
    ];
    const signed = fields.filter(([, v]) => v !== "");
    signed.push(["signature", await signature(signed)]);
    result.payment = { url: `https://${payfastHost()}/eng/process`, fields: Object.fromEntries(signed) };
  } else if (status === "requested") {
    result.eft_details = settings.eft_details;
    result.whatsapp = settings.whatsapp;
  }

  return json(201, result);
}

async function handleBookingStatus(body: Record<string, unknown>) {
  if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/.test(body.id) || typeof body.token !== "string") {
    throw new HttpError(400, "Invalid booking link.");
  }
  const { data: booking } = await db
    .from("bookings")
    .select("summary, starts_at, status, total_cents, deposit_cents, paid_cents, house_call, lookup_token_hash")
    .eq("id", body.id)
    .maybeSingle();
  if (!booking || booking.lookup_token_hash !== (await sha256Hex(body.token))) {
    throw new HttpError(404, "We couldn't find that booking.");
  }
  const { lookup_token_hash: _hidden, ...publicBooking } = booking;
  return json(200, { booking: publicBooking });
}

// ---------- Router ----------

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return json(405, { error: "Only POST is supported." });

  try {
    if (Number(request.headers.get("content-length") ?? 0) > 20_000) throw new HttpError(413, "Request too large.");
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") throw new HttpError(400, "Invalid request.");

    switch (body.action) {
      case "availability":
        return await handleAvailability(body);
      case "create_booking":
        return await handleCreateBooking(request, body);
      case "booking_status":
        return await handleBookingStatus(body);
      default:
        throw new HttpError(400, "Unknown action.");
    }
  } catch (error) {
    if (error instanceof HttpError) return json(error.status, { error: error.message });
    console.error(error);
    return json(503, { error: "Something went wrong. Please try again." });
  }
});
