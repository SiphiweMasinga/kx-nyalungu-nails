-- KX Nyalungu Nails — database schema.
-- Public visitors can read the menu, specials, gallery, hours and public settings.
-- Only the owner (a user listed in public.admins) can change content or see bookings.
-- Bookings are created only by the kx-api Edge Function, which uses the service role.

create extension if not exists btree_gist;

-- ---------- Owner accounts ----------

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create policy "Admins can see the admin list" on public.admins
  for select using (public.is_admin());

-- ---------- Settings (single row) ----------

create table public.settings (
  id smallint primary key default 1 check (id = 1),
  business_name text not null default 'KX Nyalungu Nails',
  tagline text not null default '',
  about text not null default '',
  phone text not null default '',
  whatsapp text not null default '',
  email text not null default '',
  address text not null default '',
  facebook text not null default '',
  instagram text not null default '',
  tiktok text not null default '',
  deposit_type text not null default 'percent' check (deposit_type in ('percent', 'fixed', 'none')),
  deposit_value integer not null default 50 check (deposit_value >= 0),
  house_call_fee_cents integer not null default 10000 check (house_call_fee_cents >= 0),
  slot_interval_minutes integer not null default 30 check (slot_interval_minutes between 10 and 120),
  booking_notice_hours integer not null default 2 check (booking_notice_hours between 0 and 168),
  eft_details text not null default '',
  policies text not null default '',
  owner_notification_email text not null default '',
  owner_name text not null default '',
  owner_bio text not null default '',
  owner_photo_url text not null default 'images/owner.jpg',
  updated_at timestamptz not null default now()
);
alter table public.settings enable row level security;
create policy "Anyone can read settings" on public.settings for select using (true);
create policy "Admins can update settings" on public.settings
  for update using (public.is_admin()) with check (public.is_admin());

-- The owner's notification email is private: hide it from public reads.
revoke select on public.settings from anon;
grant select (
  id, business_name, tagline, about, phone, whatsapp, email, address, facebook, instagram,
  tiktok, deposit_type, deposit_value, house_call_fee_cents, slot_interval_minutes,
  booking_notice_hours, eft_details, policies, owner_name, owner_bio, owner_photo_url, updated_at
) on public.settings to anon;

-- ---------- Menu ----------

create table public.services (
  id uuid primary key default gen_random_uuid(),
  category text not null default '',
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '',
  duration_minutes integer not null check (duration_minutes between 5 and 480),
  price_cents integer not null check (price_cents >= 0),
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.services enable row level security;
create policy "Anyone can read active services" on public.services
  for select using (active or public.is_admin());
create policy "Admins manage services" on public.services
  for all using (public.is_admin()) with check (public.is_admin());

create table public.addons (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  price_cents integer not null check (price_cents >= 0),
  duration_minutes integer not null default 0 check (duration_minutes between 0 and 120),
  active boolean not null default true,
  sort integer not null default 0
);
alter table public.addons enable row level security;
create policy "Anyone can read active add-ons" on public.addons
  for select using (active or public.is_admin());
create policy "Admins manage add-ons" on public.addons
  for all using (public.is_admin()) with check (public.is_admin());

create table public.specials (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '',
  badge text not null default '',
  special_price_cents integer check (special_price_cents is null or special_price_cents >= 0),
  service_id uuid references public.services (id) on delete set null,
  starts_on date not null default current_date,
  ends_on date not null,
  image_url text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
alter table public.specials enable row level security;
create policy "Anyone can read current specials" on public.specials
  for select using (
    public.is_admin()
    or (active and current_date between starts_on and ends_on)
  );
create policy "Admins manage specials" on public.specials
  for all using (public.is_admin()) with check (public.is_admin());

create table public.gallery (
  id uuid primary key default gen_random_uuid(),
  image_url text not null,
  caption text not null default '',
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.gallery enable row level security;
create policy "Anyone can read the gallery" on public.gallery for select using (true);
create policy "Admins manage the gallery" on public.gallery
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- Opening hours and days off ----------

create table public.business_hours (
  weekday smallint primary key check (weekday between 0 and 6), -- 0 = Sunday
  closed boolean not null default false,
  open_time time,
  close_time time,
  max_bookings integer check (max_bookings is null or max_bookings > 0), -- null = no daily limit
  check (closed or (open_time is not null and close_time is not null and close_time > open_time))
);
alter table public.business_hours enable row level security;
create policy "Anyone can read hours" on public.business_hours for select using (true);
create policy "Admins manage hours" on public.business_hours
  for all using (public.is_admin()) with check (public.is_admin());

-- School holidays (or any period) with their own hours, replacing the normal weekly hours.
create table public.holiday_periods (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'School holidays',
  starts_on date not null,
  ends_on date not null,
  open_time time not null default '09:00',
  close_time time not null default '17:00',
  max_bookings integer check (max_bookings is null or max_bookings > 0),
  check (ends_on >= starts_on),
  check (close_time > open_time)
);
alter table public.holiday_periods enable row level security;
create policy "Anyone can read holiday hours" on public.holiday_periods for select using (true);
create policy "Admins manage holiday hours" on public.holiday_periods
  for all using (public.is_admin()) with check (public.is_admin());

create table public.blocked_dates (
  day date primary key,
  reason text not null default ''
);
alter table public.blocked_dates enable row level security;
create policy "Anyone can read days off" on public.blocked_dates for select using (true);
create policy "Admins manage days off" on public.blocked_dates
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- Bookings and payments (private) ----------

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  service_id uuid references public.services (id) on delete set null,
  summary text not null,                      -- e.g. "Acrylic mani — Long + Chrome"
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  client_name text not null check (char_length(client_name) between 1 and 120),
  client_phone text not null check (char_length(client_phone) between 6 and 30),
  client_email text not null default '',
  notes text not null default '' check (char_length(notes) <= 1000),
  house_call boolean not null default false,
  house_call_address text not null default '',
  total_cents integer not null check (total_cents >= 0),
  deposit_cents integer not null check (deposit_cents >= 0),
  paid_cents integer not null default 0,
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'requested', 'confirmed', 'completed', 'cancelled', 'expired')),
  lookup_token_hash text not null check (lookup_token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  -- No two active bookings may overlap in time.
  exclude using gist (tstzrange(starts_at, ends_at) with &&)
    where (status in ('pending_payment', 'requested', 'confirmed'))
);
create index bookings_starts_at_idx on public.bookings (starts_at);
alter table public.bookings enable row level security;
create policy "Admins see bookings" on public.bookings for select using (public.is_admin());
create policy "Admins update bookings" on public.bookings
  for update using (public.is_admin()) with check (public.is_admin());

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  provider text not null default 'payfast',
  provider_payment_id text not null,
  amount_cents integer not null,
  status text not null,
  created_at timestamptz not null default now(),
  unique (provider, provider_payment_id)
);
alter table public.payments enable row level security;
create policy "Admins see payments" on public.payments for select using (public.is_admin());

-- ---------- Rate limiting for public endpoints ----------

create table public.rate_limits (
  bucket text primary key check (bucket ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null
);
alter table public.rate_limits enable row level security;

create or replace function public.consume_rate_limit(p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_count integer;
  now_ts timestamptz := clock_timestamp();
begin
  delete from public.rate_limits where window_started_at < now_ts - interval '1 day';
  insert into public.rate_limits (bucket, window_started_at, request_count)
  values (p_bucket, now_ts, 1)
  on conflict (bucket) do update set
    window_started_at = case
      when public.rate_limits.window_started_at + make_interval(secs => p_window_seconds) <= now_ts
      then now_ts else public.rate_limits.window_started_at end,
    request_count = case
      when public.rate_limits.window_started_at + make_interval(secs => p_window_seconds) <= now_ts
      then 1 else public.rate_limits.request_count + 1 end
  returning request_count into current_count;
  return current_count <= p_limit;
end;
$$;
revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

-- ---------- Image storage ----------

insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

create policy "Anyone can view media" on storage.objects
  for select using (bucket_id = 'media');
create policy "Admins upload media" on storage.objects
  for insert with check (bucket_id = 'media' and public.is_admin());
create policy "Admins update media" on storage.objects
  for update using (bucket_id = 'media' and public.is_admin());
create policy "Admins delete media" on storage.objects
  for delete using (bucket_id = 'media' and public.is_admin());

-- ---------- Starting content (from the KX Nyalungu price list) ----------

insert into public.settings (id, tagline, about, phone, whatsapp, facebook, policies, owner_bio, owner_name, address, deposit_type, deposit_value)
values (
  1,
  'Treat your nails, treat yourself 🌷',
  'Acrylics, gel and nail art done with love and a sharp eye for detail — from clean French tips to chrome, ombré and 3D flowers. Visit the studio or book a house call.',
  '0716279835',
  '27716279835',
  'https://www.facebook.com/share/1HYaTmmz4T/',
  'An R50 deposit secures your booking and goes towards your total; the balance is paid at your appointment. Please arrive on time, and give at least 24 hours'' notice if you need to reschedule.',
  'Hi, I''m Khongelani, the artist behind KX Nyalungu Nails 💅 I believe your nails should feel like a treat every single time. From sharp stiletto French tips and glossy chrome to hand-placed 3D flowers, every set is done with patience, clean technique and real love for detail. Whether you come to me or book a house call, my goal is simple: you leave feeling confident and fully treated.',
  'Khongelani Nyalungu',
  '34 Thabakgolo, next to Kgoši Mashego, 1282',
  'fixed',
  50
)
on conflict (id) do nothing;

insert into public.services (category, name, description, duration_minutes, price_cents, sort) values
  ('Acrylic mani', 'Acrylic mani — Short', 'Sculpted acrylic set, short length.', 90, 13000, 1),
  ('Acrylic mani', 'Acrylic mani — Medium', 'Sculpted acrylic set, medium length.', 105, 14000, 2),
  ('Acrylic mani', 'Acrylic mani — Long', 'Sculpted acrylic set, long length.', 120, 15000, 3),
  ('Gel', 'Gel plain mani', 'Glossy gel colour on natural nails.', 60, 12000, 4),
  ('Pedicure', 'Acrylic pedi', 'Acrylic on the toes for a long-lasting finish.', 75, 11000, 5),
  ('Pedicure', 'Gel pedi', 'Gel colour on the toes.', 60, 10000, 6),
  ('Care', 'Buff and shine', 'Buffed, shaped and polished to a natural shine.', 30, 10000, 7),
  ('Care', 'Soak off', 'Gentle removal of gel or acrylic.', 30, 5000, 8);

insert into public.addons (name, price_cents, duration_minutes, sort) values
  ('Chrome', 1000, 10, 1),
  ('3D flower', 1000, 10, 2),
  ('Ombré', 3000, 15, 3);

-- Weekdays 14:00–17:00 with at most 2 bookings; weekends 09:00–17:00 with at most 4.
insert into public.business_hours (weekday, closed, open_time, close_time, max_bookings) values
  (0, false, '09:00', '17:00', 4),
  (1, false, '14:00', '17:00', 2),
  (2, false, '14:00', '17:00', 2),
  (3, false, '14:00', '17:00', 2),
  (4, false, '14:00', '17:00', 2),
  (5, false, '14:00', '17:00', 2),
  (6, false, '09:00', '17:00', 4);

-- Public school holidays (national calendar, gov.za/about-sa/school-calendar): 09:00–17:00 daily.
insert into public.holiday_periods (name, starts_on, ends_on) values
  ('December school holidays', '2026-12-10', '2027-01-12'),
  ('March/April school holidays', '2027-03-20', '2027-04-05'),
  ('June/July school holidays', '2027-06-26', '2027-07-19'),
  ('October school holidays', '2027-10-02', '2027-10-10'),
  ('December school holidays', '2027-12-09', '2027-12-31');
