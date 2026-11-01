-- Removes the two temporary test players (zz_e2e_white, zz_e2e_black) and their test games.
delete from public.matches where id::text like 'e2e00000%';
delete from auth.users where email in ('zz_e2e_white@tg.dameo-app.com', 'zz_e2e_black@tg.dameo-app.com');
