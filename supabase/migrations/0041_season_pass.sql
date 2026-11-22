-- DAMEO 0041: DAMEO Pass (season pass) — Season 01 "Royal Legacy". Built and tested in the beta (Beta_uchun 4.10),
-- same rules as src/services/pass/core.ts (unit-tested there). Additive only: new tables and functions + 6 new
-- inventory-only shop items. Elo / rating, wallets, inventory and matches are only READ (coins are paid through
-- _wallet_apply with an idempotency key, items through user_inventory like any reward).
--  * Seasons: 21 days each from pass_settings.season_start (00:00 Asia/Tashkent); 20 levels: 100 / 250 / 450 / 800 XP.
--  * XP is NEVER reported by the client: it is derived from server rows (finished matches, mission_claims, referrals,
--    pass_checkins). Per day: the first 20 live (rated) games give 15 XP win or lose, every live win +25 (no limit),
--    3 games a day against the same opponent count, bot games 5 (15 a day) and bot wins +10 (10 a day), the first win
--    of the day +50, check-in 25, 7 days in a row +100, each daily mission 20 and all of them +40, invited friends
--    100 each (2 a day). No daily XP limit. XP boosters work per event while they run.
--  * Every reward is claimed by the player ("Olish"), once per season/level/track (PK + advisory lock).
--  * Premium: 50 Telegram Stars (an order + XTR invoice; opens ONLY on Telegram's successful_payment), or given by an
--    admin (players who pay 11 900 so'm by hand). A season ends by itself: everything is keyed by the season number.

/* ================================================================= config */
create table if not exists public.pass_settings (
  id               boolean primary key default true check (id),
  season_start     date not null default '2026-11-22',
  season_days      int  not null default 21    check (season_days between 7 and 60),
  price_som        int  not null default 11900 check (price_som between 0 and 10000000),
  price_stars      int  not null default 50    check (price_stars between 1 and 10000),
  price_stars_before int not null default 55   check (price_stars_before between 0 and 10000),
  min_moves        int  not null default 12    check (min_moves between 0 and 200),
  xp_live_game     int  not null default 15,
  xp_live_win      int  not null default 25,
  xp_bot_game      int  not null default 5,
  xp_bot_win       int  not null default 10,
  xp_first_win     int  not null default 50,
  xp_checkin       int  not null default 25,
  xp_streak        int  not null default 100,
  xp_mission       int  not null default 20,
  xp_mission_bonus int  not null default 40,
  xp_referral      int  not null default 100,
  live_per_day     int  not null default 20,
  same_opp_per_day int  not null default 3,
  bot_games_per_day int not null default 15,
  bot_wins_per_day int  not null default 10,
  referrals_per_day int not null default 2,
  updated_at       timestamptz not null default now()
);
insert into public.pass_settings (id) values (true) on conflict do nothing;

-- cumulative XP needed for each level (level 1 = 0). Steps: 2–5: 100, 6–10: 250, 11–15: 450, 16–20: 800 → 7 900.
create or replace function public._pass_level_xp(p_level int) returns int
language sql immutable set search_path = public as $$
  select case when p_level <= 1 then 0 else
    (select sum(case when n <= 5 then 100 when n <= 10 then 250 when n <= 15 then 450 else 800 end)::int
       from generate_series(2, least(p_level, 20)) n) end
$$;
create or replace function public._pass_level(p_xp int) returns int
language sql immutable set search_path = public as $$
  select coalesce(max(l), 1) from generate_series(1, 20) l where public._pass_level_xp(l) <= p_xp
$$;

create table if not exists public.pass_rewards (
  level          int  not null check (level between 1 and 20),
  track          text not null check (track in ('free', 'elite')),
  kind           text not null check (kind in ('coins', 'item', 'xp_boost', 'box', 'perk', 'emoji', 'frame', 'background', 'badge', 'title', 'combo', 'victory')),
  value          text not null,              -- amount / item slug / cosmetic id(s, comma list for emoji packs) / boost percent
  fallback_coins int  not null default 0 check (fallback_coins >= 0),
  days           int  not null default 0 check (days between 0 and 365),
  hours          int  not null default 0 check (hours between 0 and 240),     -- xp_boost: how long it runs
  keep_days      int  not null default 0 check (keep_days between 0 and 365), -- xp_boost: kept in the inventory this long
  min_coins      int  not null default 0,
  max_coins      int  not null default 0,
  amount         int  not null default 0 check (amount >= 0),
  pool           text,                       -- box: item slugs, a random one not owned yet is given
  rarity         text not null default 'common' check (rarity in ('common', 'rare', 'epic', 'legendary', 'mythic')),
  label_uz       text not null,
  label_en       text not null,
  art            text,
  note_uz        text,
  note_en        text,
  primary key (level, track)
);

/* ================================================================= player data */
create table if not exists public.pass_checkins (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day     date not null,
  primary key (user_id, day)
);
create table if not exists public.pass_elite (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  season     int  not null check (season >= 1),
  method     text not null check (method in ('stars', 'admin')),
  price      int  not null default 0,
  actor      uuid,
  note       text,
  created_at timestamptz not null default now(),
  primary key (user_id, season)
);
create table if not exists public.pass_claims (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  season     int  not null,
  level      int  not null,
  track      text not null check (track in ('free', 'elite')),
  coins      int  not null default 0,
  item       text,
  created_at timestamptz not null default now(),
  primary key (user_id, season, level, track)
);
create table if not exists public.pass_cosmetics (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('emoji', 'frame', 'background', 'badge', 'title', 'combo', 'victory')),
  id         text not null,
  season     int  not null,
  until      timestamptz,                                     -- null = forever
  created_at timestamptz not null default now(),
  primary key (user_id, kind, id)
);
create table if not exists public.pass_equipped (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind    text not null check (kind in ('emoji', 'frame', 'background', 'badge', 'title', 'victory')),
  id      text not null,
  primary key (user_id, kind)
);
-- running XP boosters
create table if not exists public.pass_boosts (
  id       bigint generated always as identity primary key,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  pct      int  not null check (pct between 1 and 200),
  starts   timestamptz not null,
  ends     timestamptz not null
);
create index if not exists pass_boosts_user_idx on public.pass_boosts (user_id, ends);
-- XP boosters kept in the inventory until the player turns them on
create table if not exists public.pass_booster_store (
  id       bigint generated always as identity primary key,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  pct      int  not null check (pct between 1 and 200),
  hours    int  not null check (hours between 1 and 240),
  expires  timestamptz not null,
  label_uz text not null,
  label_en text not null,
  used_at  timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists pass_booster_store_user_idx on public.pass_booster_store (user_id) where used_at is null;
create table if not exists public.pass_perks (
  id      bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  perk    text not null,
  amount  int  not null default 1,
  ends    timestamptz not null
);
create index if not exists pass_perks_user_idx on public.pass_perks (user_id);
-- Premium Pass orders paid with Telegram Stars
create table if not exists public.pass_orders (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references public.profiles(id) on delete cascade,
  season                     int  not null,
  stars                      int  not null check (stars > 0),
  status                     text not null default 'pending' check (status in ('pending', 'paid', 'rejected', 'refunded')),
  status_reason              text,
  tg_user_id                 bigint,
  telegram_payment_charge_id text unique,
  provider_payment_charge_id text,
  raw                        jsonb,
  created_at                 timestamptz not null default now(),
  paid_at                    timestamptz
);
create index if not exists pass_orders_user_idx on public.pass_orders (user_id, created_at desc);
-- the season XP reads a player's finished matches by side and time
create index if not exists matches_white_ended_idx on public.matches (white_id, ended_at) where status = 'finished';
create index if not exists matches_black_ended_idx on public.matches (black_id, ended_at) where status = 'finished';

alter table public.pass_settings enable row level security;
alter table public.pass_rewards  enable row level security;
alter table public.pass_checkins enable row level security;
alter table public.pass_elite    enable row level security;
alter table public.pass_claims   enable row level security;
alter table public.pass_cosmetics enable row level security;
alter table public.pass_equipped enable row level security;
alter table public.pass_boosts   enable row level security;
alter table public.pass_booster_store enable row level security;
alter table public.pass_perks    enable row level security;
alter table public.pass_orders   enable row level security;
-- everything goes through the functions below
revoke all on public.pass_settings, public.pass_rewards, public.pass_checkins, public.pass_elite, public.pass_claims,
              public.pass_cosmetics, public.pass_equipped, public.pass_boosts, public.pass_booster_store, public.pass_perks,
              public.pass_orders from anon, authenticated;
grant select, insert, update, delete on public.pass_settings, public.pass_rewards, public.pass_checkins, public.pass_elite,
      public.pass_claims, public.pass_cosmetics, public.pass_equipped, public.pass_boosts, public.pass_booster_store,
      public.pass_perks, public.pass_orders to service_role;

/* Season 01 rewards (generated from src/services/pass/core.ts DEFAULT_REWARDS) */
insert into public.pass_rewards (level, track, kind, value, fallback_coins, days, hours, keep_days, min_coins, max_coins, amount, pool, rarity, label_uz, label_en, art, note_uz, note_en) values
  (1,'free','coins','50',0,0,0,0,0,0,0,null,'common','50 Dameo Coin','50 Dameo Coins','pass/free-01.webp',null,null),
  (2,'free','item','pass-stone-classic',600,0,0,0,0,0,0,null,'rare','Classic Stone','Classic Stone','pass/stone-classic.webp','Dona skin · oq-oltin va binafsha toj donalar, inventarga tushadi','Piece skin · cream-gold and purple crown pieces, goes to your inventory'),
  (3,'free','xp_boost','10',0,0,3,30,0,0,0,null,'common','XP Booster +10% (3 soat)','XP Booster +10% (3 hours)','pass/free-03.webp','Inventarga tushadi: 30 kun ichida xohlagan paytda yoqing, 3 soat har bir o''yin XP''si +10%','Goes to your inventory: turn it on any time within 30 days, +10% XP per game for 3 hours'),
  (4,'free','frame','f-laurel',0,0,0,0,0,0,0,null,'rare','Silver Frame','Silver Frame','pass/frame-free-laurel.webp','Avatar ramkasi','Avatar frame'),
  (5,'free','coins','100',0,0,0,0,0,0,0,null,'common','100 Dameo Coin','100 Dameo Coins','pass/free-05.webp',null,null),
  (6,'free','emoji','em-cool,em-king,em-fire',0,0,0,0,0,0,0,null,'rare','Free Emoji Pack','Free Emoji Pack','pass/emoji-king.webp','3 ta emoji — ism yonida ko''rinadi','3 emoji — shown next to your name'),
  (7,'free','background','bg-simple',0,0,0,0,0,0,0,null,'common','Simple Purple','Simple Purple','pass/card-1.webp','Profil foni','Profile background'),
  (8,'free','item','fx-purple-trail',1500,0,0,0,0,0,0,null,'rare','Purple Trail','Purple Trail','pass/fx-purple-trail.webp','Yurish effekti · inventarga tushadi, o''yinda tosh binafsha iz qoldiradi','Move effect · goes to your inventory, your piece leaves a purple trail'),
  (9,'free','item','pass-violet',250,0,0,0,0,0,0,null,'common','Classic Violet Board','Classic Violet Board','pass/board-free.webp','O''yin doskasi · inventarga tushadi, o''yinda shu doskada o''ynaysiz','Game board · goes to your inventory, you play on it in games'),
  (10,'free','box','box-bronze',0,0,0,0,50,250,0,null,'rare','Bronze Chest','Bronze Chest','pass/free-19.webp','Tasodifiy sovg''a · 50–250 coin','Random gift · 50–250 coins'),
  (11,'free','coins','150',0,0,0,0,0,0,0,null,'common','150 Dameo Coin','150 Dameo Coins','pass/free-11.webp',null,null),
  (12,'free','background','bg-pattern',0,0,0,0,0,0,0,null,'rare','Royal Pattern','Royal Pattern','pass/card-2.webp','Profil foni','Profile background'),
  (13,'free','emoji','e-win',0,0,0,0,0,0,0,null,'rare','WIN Stickers','WIN Stickers','pass/free-13.webp','3 ta stiker','3 stickers'),
  (14,'free','perk','promo_s02',0,60,0,0,0,0,10,null,'rare','Season 02 chegirma','Season 02 discount','pass/free-08.webp','10% chegirma promo-kod','10% discount promo code'),
  (15,'free','coins','200',0,0,0,0,0,0,0,null,'common','200 Dameo Coin','200 Dameo Coins','pass/free-16.webp',null,null),
  (16,'free','badge','b-rookie',0,0,0,0,0,0,0,null,'rare','Rookie Badge','Rookie Badge','pass/free-14.webp','Profil belgisi','Profile badge'),
  (17,'free','title','t-active',0,7,0,0,0,0,0,null,'epic','Active Player','Active Player','pass/free-17.webp','7 kunlik unvon','7-day title'),
  (18,'free','coins','250',0,0,0,0,0,0,0,null,'rare','250 Dameo Coin','250 Dameo Coins','pass/free-11.webp',null,null),
  (19,'free','box','box-mystery',0,0,0,0,150,500,0,null,'epic','Mystery Chest','Mystery Chest','pass/free-10.webp','Sirli sovg''a · 150–500 coin','Mystery gift · 150–500 coins'),
  (20,'free','badge','b-s1',0,0,0,0,0,0,0,null,'epic','Season 01 Member','Season 01 Member','pass/free-20.webp','Doimiy mavsum belgisi','Permanent season badge'),
  (1,'elite','coins','300',0,0,0,0,0,0,0,null,'rare','300 Dameo Coin','300 Dameo Coins','pass/prem-01.webp',null,null),
  (2,'elite','item','pass-stone-royal',2500,0,0,0,0,0,0,null,'legendary','Royal Stone','Royal Stone','pass/stone-royal.webp','Premium dona skin · ko''k va qizil billur donalar, inventarga tushadi','Premium piece skin · blue and red crystal pieces, goes to your inventory'),
  (3,'elite','xp_boost','30',0,0,5,30,0,0,0,null,'epic','XP Booster +30% (5 soat)','XP Booster +30% (5 hours)','pass/prem-03.webp','Inventarga tushadi: 30 kun ichida xohlagan paytda yoqing, 5 soat har bir o''yin XP''si +30%','Goes to your inventory: turn it on any time within 30 days, +30% XP per game for 5 hours'),
  (4,'elite','emoji','em-hood,em-dragon,em-bolt,em-gem,em-cup',0,0,0,0,0,0,0,null,'legendary','Exclusive Emoji Pack','Exclusive Emoji Pack','pass/emoji-dragon.webp','5 ta premium emoji — ism yonida ko''rinadi','5 premium emoji — shown next to your name'),
  (5,'elite','coins','500',0,0,0,0,0,0,0,null,'epic','500 Dameo Coin','500 Dameo Coins','pass/prem-11.webp',null,null),
  (6,'elite','frame','f-gold-wings',0,0,0,0,0,0,0,null,'legendary','Golden Wings Frame','Golden Wings Frame','pass/frame-prem-goldwings.webp','Oltin qanotli tojli avatar ramkasi','Golden winged avatar frame with a crown'),
  (7,'elite','item','pass-royal-gold',900,0,0,0,0,0,0,null,'epic','Royal Crown Board','Royal Crown Board','pass/board-prem.webp','Premium o''yin doskasi · oltin ramka va toj bilan, inventarga tushadi','Premium board · gold frame and crown, goes to your inventory'),
  (8,'elite','item','fx-royal-lightning',4000,0,0,0,0,0,0,null,'legendary','Royal Lightning','Royal Lightning','pass/fx-royal-lightning.webp','Premium yurish effekti · oltin-binafsha iz, toj uchqunlari','Premium move effect · gold and purple trail with crown sparks'),
  (9,'elite','coins','700',0,0,0,0,0,0,0,null,'epic','700 Dameo Coin','700 Dameo Coins','pass/free-01.webp',null,null),
  (10,'elite','box','box-epic',0,0,0,0,400,800,0,'fx-sparkle,st-sapphire,royal-wood','legendary','Epic Chest','Epic Chest','pass/free-19.webp','Noyob kosmetik sovg''a: effekt, dona yoki doska (hammasi bor bo''lsa 400–800 coin)','A rare cosmetic: effect, pieces or board (400–800 coins if you own them all)'),
  (11,'elite','background','bg-throne-hall',0,0,0,0,0,0,0,null,'legendary','Royal Throne Hall','Royal Throne Hall','pass/bg-throne-hall.webp','Premium profil foni: taxt zali','Premium profile background: the throne hall'),
  (12,'elite','combo','cb-double',0,0,0,0,0,0,0,null,'legendary','Double Strike','Double Strike','pass/combo-double.webp','Combo effekti · bir yurishda 2 ta toshni ursangiz, ovozli effekt','Combo effect · capture 2 pieces in one move, with sound'),
  (13,'elite','victory','v-royal',0,0,0,0,0,0,0,null,'legendary','Victory Animation','Victory Animation','pass/prem-19.webp','Maxsus g''alaba animatsiyasi: toj, nur va oltin uchqunlar','Special victory animation: crown, rays and gold sparks'),
  (14,'elite','perk','promo_s02_20',0,60,0,0,0,0,20,null,'epic','Season 02 uchun 20% chegirma','20% off Season 02','pass/prem-15.webp','Promo-kod hisobingizga yoziladi','The promo code is saved to your account'),
  (15,'elite','coins','1000',0,0,0,0,0,0,0,null,'legendary','1000 Dameo Coin','1000 Dameo Coins','pass/free-05.webp',null,null),
  (16,'elite','badge','b-legend',0,0,0,0,0,0,0,null,'legendary','Legendary Badge','Legendary Badge','pass/prem-18.webp','Maxsus profil belgisi','Special profile badge'),
  (17,'elite','title','t-royal',0,30,0,0,0,0,0,null,'legendary','Royal Player','Royal Player','pass/prem-09.webp','30 kunlik maxsus unvon','30-day special title'),
  (18,'elite','combo','cb-triple',0,0,0,0,0,0,0,null,'mythic','Triple Strike','Triple Strike','pass/combo-triple.webp','Combo effekti · bir yurishda 3 va undan ko''p toshni ursangiz','Combo effect · capture 3 or more pieces in one move'),
  (19,'elite','frame','f-crown-wings',0,0,0,0,0,0,0,null,'mythic','Royal Crown Frame','Royal Crown Frame','pass/frame-prem-crownwings.webp','Animatsiyali eng oliy avatar ramkasi: binafsha qanotlar va toj','The top animated avatar frame: purple wings and a crown'),
  (20,'elite','badge','b-s1-gold',0,0,0,0,0,0,0,null,'mythic','Season 01 Premium','Season 01 Premium','pass/prem-17.webp','Eksklyuziv doimiy belgi','Exclusive permanent badge')
on conflict (level, track) do update set kind = excluded.kind, value = excluded.value, fallback_coins = excluded.fallback_coins,
  days = excluded.days, hours = excluded.hours, keep_days = excluded.keep_days, min_coins = excluded.min_coins, max_coins = excluded.max_coins,
  amount = excluded.amount, pool = excluded.pool, rarity = excluded.rarity, label_uz = excluded.label_uz, label_en = excluded.label_en,
  art = excluded.art, note_uz = excluded.note_uz, note_en = excluded.note_en;

/* ================================================================= DAMEO Pass game items (inventory only: not on sale) */
insert into public.shop_items (slug, category_id, slot, collection, name_uz, name_en, desc_uz, desc_en, rarity, price, is_free, is_default,
                               active, retired, style, image_url, sort)
values
  ('pass-violet', 'boards', 'board', 'pass', 'Classic Violet Board', 'Classic Violet Board', 'DAMEO Pass · Season 01 bepul doskasi.', 'DAMEO Pass · Season 01 free board.', 'rare', 0, false, false, true, true,
   '{"dt":"pass-violet-d","fi":[0.0704,0.0753,0.9341,0.9504],"fr":"pass-violet-frame","hl":"#e8bb4d","lt":"pass-violet-l","dark":"#2a1144","edge":"#3a1a5c","coord":"#eadcff","edge2":"#c9a0ff","frame":"gold","light":"#ac63cd"}', 'boards/pass-violet.webp', 900),
  ('pass-royal-gold', 'boards', 'board', 'pass', 'Royal Gold Board', 'Royal Gold Board', 'DAMEO Pass · Season 01 Premium doskasi: oltin ramka, toj.', 'DAMEO Pass · Season 01 Premium board: gold frame and crown.', 'epic', 0, false, false, true, true,
   '{"dt":"pass-royal-gold-d","fi":[0.0832,0.1328,0.9159,0.8696],"fr":"pass-royal-gold-frame","hl":"#e8bb4d","lt":"pass-royal-gold-l","dark":"#150b24","edge":"#4a2a10","coord":"#eadcff","edge2":"#d4a53c","frame":"gold","light":"#972dc9"}', 'boards/pass-royal-gold.webp', 901),
  ('fx-purple-trail', 'animations', 'effect', 'pass', 'Purple Trail', 'Purple Trail', 'DAMEO Pass · tosh binafsha iz qoldiradi.', 'DAMEO Pass · your piece leaves a purple trail.', 'rare', 0, false, false, true, true,
   '{"fx":"trail","color":"#b45cff"}', 'pass/fx-purple-trail.webp', 902),
  ('fx-royal-lightning', 'animations', 'effect', 'pass', 'Royal Lightning', 'Royal Lightning', 'DAMEO Pass Premium · oltin-binafsha iz va toj uchqunlari.', 'DAMEO Pass Premium · gold and purple trail with crown sparks.', 'legendary', 0, false, false, true, true,
   '{"fx":"royal","color":"#ffc23d"}', 'pass/fx-royal-lightning.webp', 903),
  ('pass-stone-classic', 'stones', 'piece', 'pass', 'Classic Stone · Pass', 'Classic Stone · Pass', 'DAMEO Pass · oq-oltin va binafsha toj donalar.', 'DAMEO Pass · cream-gold and purple crown pieces.', 'rare', 0, false, false, true, true,
   '{"w":{"tex":"pass-stone-classic-w","ring":"rgba(230,180,70,.85)","crown":"#d4a017","c3":"#c9a227"},"b":{"tex":"pass-stone-classic-b","ring":"rgba(250,204,21,.9)","crown":"#fbbf24","c3":"#3b0764","edge":"#fbbf24"}}', 'stones/pass-stone-classic.webp', 904),
  ('pass-stone-royal', 'stones', 'piece', 'pass', 'Royal Stone', 'Royal Stone', 'DAMEO Pass Premium · ko''k va qizil billur donalar.', 'DAMEO Pass Premium · blue and red crystal pieces.', 'legendary', 0, false, false, true, true,
   '{"w":{"tex":"pass-stone-royal-w","ring":"rgba(120,200,255,.9)","crown":"#bfe3ff","c3":"#1e3a8a","glow":"rgba(80,160,255,.55)"},"b":{"tex":"pass-stone-royal-b","ring":"rgba(255,120,60,.9)","crown":"#ffb347","c3":"#450a0a","glow":"rgba(255,80,40,.5)"}}', 'stones/pass-stone-royal.webp', 905)
on conflict (slug) do update set name_uz = excluded.name_uz, name_en = excluded.name_en, desc_uz = excluded.desc_uz, desc_en = excluded.desc_en,
  style = excluded.style, image_url = excluded.image_url, collection = 'pass', retired = true, active = true;

/* ================================================================= season + XP */
create or replace function public._pass_day() returns date
language sql stable set search_path = public as $$ select (now() at time zone 'Asia/Tashkent')::date $$;

create or replace function public._pass_season(p_at timestamptz default now(),
                                               out n int, out t0 timestamptz, out t1 timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare s public.pass_settings; a timestamptz;
begin
  select * into s from public.pass_settings where id;
  a := s.season_start::timestamp at time zone 'Asia/Tashkent';
  n := greatest(1, floor(extract(epoch from (p_at - a)) / (s.season_days * 86400))::int + 1);
  t0 := a + make_interval(days => (n - 1) * s.season_days);
  t1 := t0 + make_interval(days => s.season_days);
end $$;

-- Season XP of a player (see the header for the rules). total = whole season, today = this Tashkent day.
create or replace function public._pass_xp(p_uid uuid, out total int, out today int, out lines json)
language plpgsql stable security definer set search_path = public as $$
declare s public.pass_settings; sn record; d date := public._pass_day(); d0 date; d1 date;
begin
  select * into s from public.pass_settings where id;
  select * into sn from public._pass_season();
  d0 := (sn.t0 at time zone 'Asia/Tashkent')::date;
  d1 := (sn.t1 at time zone 'Asia/Tashkent')::date;
  with mine as (
    select m.ended_at as ts, m.result, m.white_id, m.black_id, m.virtual_id, m.rated, m.vs_bot, m.move_count
      from public.matches m
     where m.status = 'finished' and m.white_id = p_uid and m.ended_at >= sn.t0 and m.ended_at < sn.t1
    union all
    select m.ended_at, m.result, m.white_id, m.black_id, m.virtual_id, m.rated, m.vs_bot, m.move_count
      from public.matches m
     where m.status = 'finished' and m.black_id = p_uid and m.white_id is distinct from p_uid
       and m.ended_at >= sn.t0 and m.ended_at < sn.t1
  ), live as (       -- rated games: people and virtual opponents
    select x.ts, (x.ts at time zone 'Asia/Tashkent')::date as day,
           case when x.white_id = p_uid then coalesce(x.black_id::text, x.virtual_id::text, 'bot') else x.white_id::text end as opp,
           ((x.result = 'white' and x.white_id = p_uid) or (x.result = 'black' and x.black_id = p_uid)) as won
      from mine x
     where x.rated and x.move_count >= s.min_moves
  ), live_o as (     -- at most N a day against the same opponent
    select l.*, row_number() over (partition by l.day, l.opp order by l.ts) as k from live l
  ), live_c as (
    select l.*, row_number() over (partition by l.day order by l.ts) as rn from live_o l where l.k <= s.same_opp_per_day
  ), bot as (        -- practice bot (the player is always White there)
    select x.ts, (x.ts at time zone 'Asia/Tashkent')::date as day, (x.result = 'white') as won,
           row_number() over (partition by (x.ts at time zone 'Asia/Tashkent')::date order by x.ts) as rn
      from mine x
     where x.vs_bot and x.virtual_id is null and not x.rated and x.white_id = p_uid and x.move_count >= s.min_moves
  ), bot_c as (
    select b.*, row_number() over (partition by b.day, b.won order by b.ts) as wn from bot b where b.rn <= s.bot_games_per_day
  ), refs as (
    select f.created_at as ts, (f.created_at at time zone 'Asia/Tashkent')::date as day,
           row_number() over (partition by (f.created_at at time zone 'Asia/Tashkent')::date order by f.created_at, f.id) as rn
      from public.referrals f
     where f.inviter_id = p_uid and f.created_at >= sn.t0 and f.created_at < sn.t1
  ), ev as (         -- events with a time (boosters apply to these)
    select day, ts, 'live_game'::text as source, s.xp_live_game as xp from live_c where rn <= s.live_per_day
    union all select day, ts, 'live_win', s.xp_live_win from live_c where won
    union all select day, ts, 'bot_game', s.xp_bot_game from bot_c
    union all select day, ts, 'bot_win', s.xp_bot_win from bot_c where won and wn <= s.bot_wins_per_day
    union all select w.day, min(w.ts), 'first_win', s.xp_first_win
                from (select day, ts from live_c where won union all select day, ts from bot_c where won) w group by w.day
    union all select day, ts, 'referral', s.xp_referral from refs where rn <= s.referrals_per_day
  ), evb as (        -- the strongest booster running at that moment adds its percent (no stacking)
    select e.day, e.source,
           e.xp + (e.xp * coalesce((select max(bo.pct) from public.pass_boosts bo
                                     where bo.user_id = p_uid and bo.starts <= e.ts and bo.ends > e.ts), 0)) / 100 as xp
      from ev e
  ), ci as (
    select c.day, row_number() over (order by c.day) as i
      from public.pass_checkins c where c.user_id = p_uid and c.day >= d0 and c.day < d1
  ), ci_run as (     -- position inside a run of days in a row
    select day, row_number() over (partition by day - i::int order by day) as run from ci
  ), mc as (
    select x.mission, x.period::date as day
      from public.mission_claims x
     where x.user_id = p_uid and x.mission like 'd\_%' and x.period ~ '^\d{4}-\d{2}-\d{2}$'
       and x.period >= d0::text and x.period < d1::text
  ), src as (
    select day, source, count(*)::int as cnt, sum(xp)::int as xp from evb group by day, source
    union all select day, 'checkin', 1, s.xp_checkin from ci_run
    union all select day, 'streak', 1, s.xp_streak from ci_run where run % 7 = 0
    union all select day, 'mission', count(*)::int, count(*)::int * s.xp_mission from mc where mission <> 'd_bonus' group by day
    union all select day, 'mission_bonus', 1, s.xp_mission_bonus from mc where mission = 'd_bonus'
  )
  select coalesce(sum(src.xp), 0)::int,
         coalesce(sum(src.xp) filter (where src.day = d), 0)::int,
         coalesce(json_agg(json_build_object('source', src.source, 'count', src.cnt, 'xp', src.xp)) filter (where src.day = d), '[]'::json)
    into total, today, lines
    from src;
end $$;
revoke all on function public._pass_xp(uuid) from public, anon, authenticated;

/* ================================================================= player API */
create or replace function public._pass_worn(p_uid uuid) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_object_agg(t.k, t.v), '{}'::json) from (
    select q.kind as k, q.id as v
      from public.pass_equipped q
      join public.pass_cosmetics c on c.user_id = q.user_id and c.kind = q.kind and c.id = q.id
     where q.user_id = p_uid and (c.until is null or c.until > now())
    union all          -- combo effects work as soon as they are owned
    select 'combo', string_agg(c.id, ',' order by c.id)
      from public.pass_cosmetics c
     where c.user_id = p_uid and c.kind = 'combo' and (c.until is null or c.until > now())
    having count(*) > 0
  ) t
$$;
revoke all on function public._pass_worn(uuid) from public, anon, authenticated;

create or replace function public.pass_me() returns json
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); sn record; x record; s public.pass_settings; d date := public._pass_day();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into s from public.pass_settings where id;
  select * into sn from public._pass_season();
  select * into x from public._pass_xp(uid);
  return json_build_object(
    'season', sn.n,
    'season_start', (extract(epoch from sn.t0) * 1000)::bigint,
    'season_end', (extract(epoch from sn.t1) * 1000)::bigint,
    'xp', x.total,
    'today', json_build_object('total', x.total, 'today', x.today, 'capped', false, 'todayLines', x.lines),
    'boost_today', coalesce((select max(bo.pct) from public.pass_boosts bo where bo.user_id = uid and bo.starts <= now() and bo.ends > now()), 0),
    'elite', exists (select 1 from public.pass_elite e where e.user_id = uid and e.season = sn.n),
    'price', json_build_object('som', s.price_som, 'stars', s.price_stars, 'starsBefore', s.price_stars_before),
    'checked_in', exists (select 1 from public.pass_checkins c where c.user_id = uid and c.day = d),
    'claims', coalesce((select json_agg(c.track || ':' || c.level) from public.pass_claims c where c.user_id = uid and c.season = sn.n), '[]'::json),
    'owned', coalesce((select json_agg(json_build_object('id', c.id, 'kind', c.kind, 'season', c.season,
                         'until', case when c.until is null then null else (extract(epoch from c.until) * 1000)::bigint end))
                         from public.pass_cosmetics c where c.user_id = uid and (c.until is null or c.until > now())), '[]'::json),
    'equipped', public._pass_worn(uid),
    'balance', coalesce((select w.balance from public.user_wallets w where w.user_id = uid), 0),
    'rewards', (select json_agg(row_to_json(r) order by r.level, r.track) from public.pass_rewards r),
    'perks', coalesce((select json_agg(json_build_object('id', p.perk, 'amount', p.amount, 'until', (extract(epoch from p.ends) * 1000)::bigint))
                         from public.pass_perks p where p.user_id = uid and p.ends > now()), '[]'::json));
end $$;
revoke all on function public.pass_me() from public, anon;
grant execute on function public.pass_me() to authenticated;

-- what a player wears (any player: shown on their profile, next to their name, in their games)
create or replace function public.pass_worn(p_user uuid) returns json
language sql stable security definer set search_path = public as $$ select public._pass_worn(p_user) $$;
revoke all on function public.pass_worn(uuid) from public;
grant execute on function public.pass_worn(uuid) to anon, authenticated;

create or replace function public.pass_checkin() returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  insert into public.pass_checkins (user_id, day) values (uid, public._pass_day()) on conflict do nothing;
  get diagnostics n = row_count;
  return json_build_object('ok', n = 1);
end $$;
revoke all on function public.pass_checkin() from public, anon;
grant execute on function public.pass_checkin() to authenticated;

-- Gives a catalog item for free (never a Limited Edition copy). Non-limited boards get the next serial like a purchase.
-- false = already owned or cannot be given (the caller pays fallback coins).
create or replace function public._pass_grant_item(p_uid uuid, p_slug text) returns boolean
language plpgsql security definer set search_path = public as $$
declare st public.board_inventory; n int;
begin
  if exists (select 1 from public.user_inventory where user_id = p_uid and item_slug = p_slug) then return false; end if;
  if not exists (select 1 from public.shop_items where slug = p_slug and active) then return false; end if;
  if exists (select 1 from public.shop_items where slug = p_slug and (is_free or is_default)) then return false; end if;
  if exists (select 1 from public.board_catalog where slug = p_slug) then
    if exists (select 1 from public.user_board_collections where user_id = p_uid and board_slug = p_slug) then return false; end if;
    select * into st from public.board_inventory where slug = p_slug for update;
    if not found or st.supply is not null then return false; end if;
    n := st.sold + 1;
    update public.board_inventory set sold = n, updated_at = now() where slug = p_slug;
    insert into public.user_board_collections (user_id, board_slug, serial, price_paid) values (p_uid, p_slug, n, 0);
  end if;
  insert into public.user_inventory (user_id, item_slug, source) values (p_uid, p_slug, 'reward') on conflict do nothing;
  return true;
end $$;
revoke all on function public._pass_grant_item(uuid, text) from public, anon, authenticated;

create or replace function public.pass_claim(p_level int, p_track text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); sn record; rw public.pass_rewards; lvl int; elite boolean;
        coins int := 0; item text; cosmetic text; boost int := 0; bal bigint; v_until timestamptz; slug text;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if public._is_banned(uid) then raise exception 'account restricted'; end if;
  select * into sn from public._pass_season();
  perform pg_advisory_xact_lock(hashtextextended('pass:' || uid::text || ':' || sn.n, 0));   -- double taps, two devices
  select * into rw from public.pass_rewards where level = p_level and track = p_track;
  if not found then return json_build_object('ok', false, 'error', 'unknown'); end if;
  if exists (select 1 from public.pass_claims c where c.user_id = uid and c.season = sn.n and c.level = p_level and c.track = p_track) then
    return json_build_object('ok', false, 'error', 'already');
  end if;
  lvl := public._pass_level((select total from public._pass_xp(uid)));
  if p_level > lvl then return json_build_object('ok', false, 'error', 'locked'); end if;
  elite := exists (select 1 from public.pass_elite e where e.user_id = uid and e.season = sn.n);
  if p_track = 'elite' and not elite then return json_build_object('ok', false, 'error', 'elite'); end if;

  if rw.kind = 'coins' then
    coins := rw.value::int;
  elsif rw.kind = 'box' then
    if rw.pool is not null then      -- a chest with game items: a random one not owned yet
      for slug in select btrim(x) from unnest(string_to_array(rw.pool, ',')) x order by random() loop
        if public._pass_grant_item(uid, slug) then item := slug; exit; end if;
      end loop;
    end if;
    if item is null then
      coins := rw.min_coins + floor(random() * (greatest(rw.max_coins, rw.min_coins) - rw.min_coins + 1))::int;
    end if;
  elsif rw.kind = 'item' then
    if public._pass_grant_item(uid, rw.value) then item := rw.value; else coins := rw.fallback_coins; end if;
  elsif rw.kind = 'perk' then
    insert into public.pass_perks (user_id, perk, amount, ends)
    values (uid, rw.value, greatest(rw.amount, 1), now() + make_interval(days => greatest(rw.days, 1)));
  elsif rw.kind = 'xp_boost' then
    boost := rw.value::int;
    if rw.keep_days > 0 and rw.hours > 0 then      -- kept in the inventory, turned on by the player
      insert into public.pass_booster_store (user_id, pct, hours, expires, label_uz, label_en)
      values (uid, boost, rw.hours, now() + make_interval(days => rw.keep_days), rw.label_uz, rw.label_en);
    else
      insert into public.pass_boosts (user_id, pct, starts, ends)
      values (uid, boost, now(), now() + case when rw.hours > 0 then make_interval(hours => rw.hours) else make_interval(days => greatest(rw.days, 1)) end);
    end if;
  else
    cosmetic := rw.kind;
    v_until := case when rw.days > 0 then now() + make_interval(days => rw.days) end;
    insert into public.pass_cosmetics (user_id, kind, id, season, until)
    select uid, rw.kind, btrim(x), sn.n, v_until from unnest(string_to_array(rw.value, ',')) x     -- emoji packs: several ids
    on conflict (user_id, kind, id) do update
      set until = case when public.pass_cosmetics.until is null or excluded.until is null then null
                       else greatest(public.pass_cosmetics.until, excluded.until) end;
    if rw.kind <> 'combo' then                                                                   -- the first of a kind is worn
      insert into public.pass_equipped (user_id, kind, id) values (uid, rw.kind, btrim(split_part(rw.value, ',', 1)))
      on conflict (user_id, kind) do nothing;
    end if;
  end if;
  insert into public.pass_claims (user_id, season, level, track, coins, item) values (uid, sn.n, p_level, p_track, coins, item);
  if coins > 0 then
    bal := public._wallet_apply(uid, coins, 'reward', 'pass', p_track || ':' || p_level,
                                'pass:' || sn.n || ':' || p_track || ':' || p_level, 'DAMEO Pass season ' || sn.n, null);
  else
    select coalesce(w.balance, 0) into bal from public.user_wallets w where w.user_id = uid;
  end if;
  return json_build_object('ok', true, 'coins', coins, 'item', item, 'cosmetic', cosmetic, 'boost', boost, 'balance', coalesce(bal, 0),
    'item_name_uz', (select i.name_uz from public.shop_items i where i.slug = item),
    'item_name_en', (select i.name_en from public.shop_items i where i.slug = item));
end $$;
revoke all on function public.pass_claim(int, text) from public, anon;
grant execute on function public.pass_claim(int, text) to authenticated;

create or replace function public.pass_equip(p_kind text, p_id text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_kind not in ('emoji', 'frame', 'background', 'badge', 'title', 'victory') then return json_build_object('ok', false); end if;
  if p_id is null then
    delete from public.pass_equipped where user_id = uid and kind = p_kind;
    return json_build_object('ok', true);
  end if;
  if not exists (select 1 from public.pass_cosmetics c where c.user_id = uid and c.kind = p_kind and c.id = p_id
                   and (c.until is null or c.until > now())) then
    return json_build_object('ok', false);
  end if;
  insert into public.pass_equipped (user_id, kind, id) values (uid, p_kind, p_id)
  on conflict (user_id, kind) do update set id = excluded.id;
  return json_build_object('ok', true);
end $$;
revoke all on function public.pass_equip(text, text) from public, anon;
grant execute on function public.pass_equip(text, text) to authenticated;

-- XP boosters in the inventory + the running one
create or replace function public.pass_boosters() returns json
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  return json_build_object(
    'stored', coalesce((select json_agg(json_build_object('id', b.id::text, 'pct', b.pct, 'hours', b.hours,
                          'expires', (extract(epoch from b.expires) * 1000)::bigint, 'label_uz', b.label_uz, 'label_en', b.label_en) order by b.expires)
                          from public.pass_booster_store b where b.user_id = uid and b.used_at is null and b.expires > now()), '[]'::json),
    'active', (select json_build_object('pct', bo.pct, 'from', (extract(epoch from bo.starts) * 1000)::bigint, 'until', (extract(epoch from bo.ends) * 1000)::bigint)
                 from public.pass_boosts bo where bo.user_id = uid and bo.starts <= now() and bo.ends > now() order by bo.pct desc limit 1));
end $$;
revoke all on function public.pass_boosters() from public, anon;
grant execute on function public.pass_boosters() to authenticated;

-- Turns a stored booster on: it runs for its hours from now. Refused while another one runs (no waste).
create or replace function public.pass_booster_use(p_id bigint) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); b public.pass_booster_store; v_until timestamptz;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('passboost:' || uid::text, 0));
  select * into b from public.pass_booster_store where id = p_id and user_id = uid and used_at is null for update;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if b.expires <= now() then return json_build_object('ok', false, 'error', 'expired'); end if;
  if exists (select 1 from public.pass_boosts bo where bo.user_id = uid and bo.starts <= now() and bo.ends > now()) then
    return json_build_object('ok', false, 'error', 'active');
  end if;
  v_until := now() + make_interval(hours => b.hours);
  insert into public.pass_boosts (user_id, pct, starts, ends) values (uid, b.pct, now(), v_until);
  update public.pass_booster_store set used_at = now() where id = b.id;
  return json_build_object('ok', true, 'until', (extract(epoch from v_until) * 1000)::bigint);
end $$;
revoke all on function public.pass_booster_use(bigint) from public, anon;
grant execute on function public.pass_booster_use(bigint) to authenticated;

-- Premium by hand (a player paid 11 900 so'm to the admin): an admin with 'payments.view' opens it; audited.
create or replace function public.pass_grant_premium(p_user uuid, p_note text default null) returns json
language plpgsql security definer set search_path = public as $$
declare a uuid; sn record; s public.pass_settings; n int;
begin
  a := public._admin_require('payments.view');
  if not exists (select 1 from public.profiles where id = p_user) then return json_build_object('ok', false, 'error', 'user not found'); end if;
  select * into s from public.pass_settings where id;
  select * into sn from public._pass_season();
  insert into public.pass_elite (user_id, season, method, price, actor, note) values (p_user, sn.n, 'admin', s.price_som, a, p_note)
  on conflict do nothing;
  get diagnostics n = row_count;
  if n = 1 then
    perform public._audit(a, 'pass_grant_premium', 'user', p_user::text, p_note, jsonb_build_object('season', sn.n));
  end if;
  return json_build_object('ok', n = 1, 'season', sn.n, 'already', n = 0);
end $$;
revoke all on function public.pass_grant_premium(uuid, text) from public, anon;
grant execute on function public.pass_grant_premium(uuid, text) to authenticated;

/* ================================================================= Premium with Telegram Stars */
-- (service role) the `payments` Edge Function asks for an order before it creates the XTR invoice (payload 'pass:<order id>')
create or replace function public.pass_order_create(p_user uuid) returns json
language plpgsql security definer set search_path = public as $$
declare s public.pass_settings; sn record; o public.pass_orders; tgid bigint;
begin
  if public._is_banned(p_user) then raise exception 'account restricted'; end if;
  select * into s from public.pass_settings where id;
  select * into sn from public._pass_season();
  if exists (select 1 from public.pass_elite e where e.user_id = p_user and e.season = sn.n) then raise exception 'already premium'; end if;
  if (select count(*) from public.pass_orders where user_id = p_user and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'too many orders';
  end if;
  select tg_id into tgid from public.profiles where id = p_user;
  insert into public.pass_orders (user_id, season, stars, tg_user_id) values (p_user, sn.n, s.price_stars, tgid) returning * into o;
  return json_build_object('order_id', o.id, 'stars', o.stars, 'season', o.season, 'season_end', sn.t1);
end $$;

-- (service role) Telegram pre_checkout_query for 'pass:<id>': null = allow, text = refuse
create or replace function public.pass_payment_precheck(p_order uuid, p_stars int, p_currency text, p_tg bigint) returns text
language plpgsql security definer set search_path = public as $$
declare o public.pass_orders; sn record;
begin
  select * into o from public.pass_orders where id = p_order;
  if not found then return 'order not found'; end if;
  if o.status <> 'pending' then return 'order is ' || o.status; end if;
  if o.created_at < now() - interval '1 day' then return 'order expired'; end if;
  if p_currency <> 'XTR' or p_stars <> o.stars then return 'amount mismatch'; end if;
  if o.tg_user_id is distinct from p_tg then return 'wrong account'; end if;
  select * into sn from public._pass_season();
  if o.season <> sn.n then return 'season ended'; end if;
  if exists (select 1 from public.pass_elite e where e.user_id = o.user_id and e.season = o.season) then return 'already premium'; end if;
  return null;
end $$;

-- (service role) Telegram successful_payment: Premium opens exactly once (unique charge id), only now
create or replace function public.pass_payment_complete(p_order uuid, p_charge text, p_provider_charge text, p_stars int, p_tg bigint, p_raw jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare o public.pass_orders;
begin
  if p_charge is null or length(p_charge) < 4 then raise exception 'charge id required'; end if;
  if exists (select 1 from public.pass_orders where telegram_payment_charge_id = p_charge) then
    return json_build_object('ok', true, 'duplicate', true);
  end if;
  select * into o from public.pass_orders where id = p_order for update;
  if not found then return json_build_object('ok', false, 'error', 'order not found'); end if;
  if o.status in ('paid', 'refunded') then return json_build_object('ok', true, 'duplicate', true); end if;
  if p_stars <> o.stars or o.tg_user_id is distinct from p_tg then
    update public.pass_orders set status_reason = 'needs review: paid amount/account mismatch', raw = p_raw,
           telegram_payment_charge_id = p_charge, provider_payment_charge_id = p_provider_charge where id = o.id;
    return json_build_object('ok', false, 'error', 'needs review');
  end if;
  update public.pass_orders set status = 'paid', status_reason = null, paid_at = now(), telegram_payment_charge_id = p_charge,
         provider_payment_charge_id = p_provider_charge, raw = p_raw where id = o.id;
  insert into public.pass_elite (user_id, season, method, price) values (o.user_id, o.season, 'stars', o.stars) on conflict do nothing;
  return json_build_object('ok', true, 'user_id', o.user_id, 'season', o.season);
end $$;
revoke all on function public.pass_order_create(uuid) from public, anon, authenticated;
revoke all on function public.pass_payment_precheck(uuid, int, text, bigint) from public, anon, authenticated;
revoke all on function public.pass_payment_complete(uuid, text, text, int, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.pass_order_create(uuid) to service_role;
grant execute on function public.pass_payment_precheck(uuid, int, text, bigint) to service_role;
grant execute on function public.pass_payment_complete(uuid, text, text, int, bigint, jsonb) to service_role;
revoke all on function public._pass_season(timestamptz) from public, anon, authenticated;
-- _pass_level_xp / _pass_level / _pass_day are harmless pure helpers and stay callable
