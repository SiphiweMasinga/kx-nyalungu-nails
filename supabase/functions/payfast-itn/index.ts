// PayFast Instant Transaction Notification (ITN) handler.
// PayFast calls this after a payment. We confirm the booking only when all checks pass:
//   1. the signature matches, 2. PayFast's server says the data is VALID,
//   3. the merchant ID and amount match what we expect, 4. the payment is COMPLETE.
// Docs: https://developers.payfast.co.za/docs#step_4_confirm_payment
import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { centsToRand, md5Hex, paramString, payfastHost } from "../_shared/payfast.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

// PayFast only needs a 200 response; details are logged for the owner/developer.
const ok = () => new Response("OK", { status: 200 });

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const raw = await request.text();
  // Keep the fields in the order PayFast sent them — the signature depends on it.
  const pairs = [...new URLSearchParams(raw).entries()];
  const data = Object.fromEntries(pairs);
  const unsigned = pairs.filter(([key]) => key !== "signature");

  // 1. Signature
  let base = paramString(unsigned);
  const passphrase = Deno.env.get("PAYFAST_PASSPHRASE");
  if (passphrase) base += `&passphrase=${encodeURIComponent(passphrase.trim()).replace(/%20/g, "+")}`;
  if ((await md5Hex(base)) !== data.signature) {
    console.error("ITN rejected: bad signature", data.m_payment_id);
    return ok();
  }

  // 2. Server-to-server validation with PayFast
  const validation = await fetch(`https://${payfastHost()}/eng/query/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: paramString(unsigned),
  });
  if ((await validation.text()).trim() !== "VALID") {
    console.error("ITN rejected: PayFast validation failed", data.m_payment_id);
    return ok();
  }

  // 3. Merchant and amount
  if (data.merchant_id !== Deno.env.get("PAYFAST_MERCHANT_ID")) {
    console.error("ITN rejected: merchant mismatch");
    return ok();
  }
  const { data: booking } = await db
    .from("bookings")
    .select("id, status, deposit_cents, summary, starts_at, client_name, client_phone")
    .eq("id", data.m_payment_id ?? "")
    .maybeSingle();
  if (!booking) {
    console.error("ITN rejected: unknown booking", data.m_payment_id);
    return ok();
  }
  const paidCents = Math.round(Number(data.amount_gross) * 100);
  if (Math.abs(paidCents - booking.deposit_cents) > 1) {
    console.error(`ITN rejected: amount R${data.amount_gross} ≠ deposit R${centsToRand(booking.deposit_cents)}`);
    return ok();
  }

  // Record every notification once (PayFast may retry).
  const { error: paymentError } = await db.from("payments").insert({
    booking_id: booking.id,
    provider: "payfast",
    provider_payment_id: data.pf_payment_id ?? "",
    amount_cents: paidCents,
    status: data.payment_status ?? "",
  });
  if (paymentError && paymentError.code !== "23505") console.error("Payment insert failed", paymentError.message);

  // 4. Payment complete → confirm the booking (only from a waiting state).
  if (data.payment_status === "COMPLETE") {
    await db
      .from("bookings")
      .update({ status: "confirmed", paid_cents: paidCents })
      .eq("id", booking.id)
      .in("status", ["pending_payment", "expired"]);

    const apiKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("EMAIL_FROM");
    const { data: settings } = await db.from("settings").select("owner_notification_email").eq("id", 1).single();
    if (apiKey && from && settings?.owner_notification_email) {
      const when = new Date(booking.starts_at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" });
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [settings.owner_notification_email],
          subject: `Paid booking: ${booking.summary} — ${when}`,
          text: `${booking.client_name} (${booking.client_phone}) paid a R${centsToRand(paidCents)} deposit for ${booking.summary} on ${when}.`,
        }),
      }).catch((error) => console.error("Owner email failed", error));
    }
  }

  return ok();
});
