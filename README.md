# KX Nyalungu Nails — website

A modern, mobile-first website for KX Nyalungu Nails with:

- **Price list, add-ons and house calls** from the KX Nyalungu price list
- **Specials** the owner posts herself, with start and end dates (they disappear automatically)
- **Online bookings** — clients choose a service, add-ons, date and an open time slot
- **Online deposits** through **PayFast** (card, Instant EFT, SnapScan and more); bookings are confirmed automatically when PayFast reports the payment
- **AI assistant** powered by **Claude** that answers questions using the live prices, specials and hours
- **Owner dashboard** (`/admin`) to manage bookings, specials, prices, add-ons, gallery photos, hours, days off, deposit rules and contact details — no coding needed

Without a backend connected, the site runs in **demo mode**: it shows the real price list with sample
opening hours, and bookings are sent to WhatsApp instead of being saved.

## How it fits together

| Part | Where |
|---|---|
| Website (static HTML/CSS/JS) | GitHub Pages |
| Database, owner login, photo storage | Supabase |
| Bookings, availability, AI assistant | `supabase/functions/kx-api` (Supabase Edge Function) |
| Payment confirmation from PayFast | `supabase/functions/payfast-itn` |

Secret keys (Supabase service role, PayFast, Anthropic) live only in Supabase Edge Function secrets —
never in the website files.

## Setup

1. **Create a Supabase project** at [supabase.com](https://supabase.com) (free tier is fine).
2. **Create the database:** in the Supabase SQL editor, run
   `supabase/migrations/20261120000000_init.sql`. It creates the tables, security rules, photo
   storage, and loads the KX Nyalungu price list.
3. **Deploy the functions** (needs the [Supabase CLI](https://supabase.com/docs/guides/cli)):

   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase functions deploy kx-api
   supabase functions deploy payfast-itn
   ```

4. **Add Edge Function secrets** (Supabase dashboard → Edge Functions → Secrets):

   | Secret | Value |
   |---|---|
   | `SITE_URL` | The live site address, e.g. `https://siphiwemasinga.github.io/kx-nyalungu-nails` |
   | `ANTHROPIC_API_KEY` | From [console.anthropic.com](https://console.anthropic.com) — powers the AI assistant |
   | `RATE_LIMIT_SALT` | Any long random string |
   | `PAYFAST_MERCHANT_ID` | From the PayFast dashboard → Settings → Integration |
   | `PAYFAST_MERCHANT_KEY` | Same place |
   | `PAYFAST_PASSPHRASE` | The passphrase you set in PayFast (recommended) |
   | `PAYFAST_MODE` | `sandbox` while testing, `live` when ready for real payments |
   | `RESEND_API_KEY`, `EMAIL_FROM` | Optional — emails the owner about new bookings |

   Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` automatically.
   If PayFast isn't set up yet, bookings are saved as "awaiting EFT deposit" and clients are shown
   the EFT details from Settings instead.

5. **Create the owner login:** Supabase dashboard → Authentication → Users → *Add user* (her email
   and a strong password). Copy the new user's ID and run in the SQL editor:

   ```sql
   insert into public.admins (user_id) values ('PASTE-USER-ID-HERE');
   ```

6. **Connect the website:** put the project URL and the **anon / publishable** key (Supabase →
   Project Settings → API) into `config.js`, then push to GitHub. The demo ribbon disappears and the
   site reads everything from the database.

7. **Test with PayFast sandbox** (use sandbox merchant details and `PAYFAST_MODE=sandbox`), then
   switch to live details and `PAYFAST_MODE=live`.

## Owner dashboard

Go to `/admin` on the live site and log in. Tabs:

- **Bookings** — upcoming/today/past, WhatsApp a client, confirm EFT deposits, cancel, mark done
- **Specials** — post a special with dates, a badge, an optional photo and an optional special price
- **Prices** — edit services, prices, durations and add-ons; hide items without deleting them
- **Gallery** — upload photos straight from her phone and add captions
- **Hours** — opening hours per day and days off
- **Settings** — contact details, deposit rule (currently 50%), house call fee, booking policy

## AI assistant

The assistant uses Claude (`claude-opus-5-5`) through the official Anthropic SDK. Each answer is
grounded in the live business facts from the database (services, add-ons, specials, hours, policy),
so when the owner changes a price the assistant knows straight away. It is told never to invent
prices or confirm bookings, and it is rate-limited per visitor to control cost. To reduce cost
further, the model can be changed in `supabase/functions/kx-api/index.ts`.

## Photos

Put the studio's photos in `images/` as `work-1.jpg` … `work-5.jpg` for demo mode and the hero.
After setup, gallery photos are managed from the dashboard.

## Privacy

Bookings store the client's name, phone, optional email and notes so the owner can manage the
appointment. Only the owner can see them. Card details are handled entirely by PayFast and never
touch this site.
