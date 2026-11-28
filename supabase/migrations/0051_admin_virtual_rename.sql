-- 0051 — Admin: rename a virtual opponent (permission virtual.manage, reason required, written to the audit log).
--  The name must be 3…20 characters with no spaces, unique among virtual opponents (case-insensitive) and not taken by a
--  real player's username, so a virtual opponent can never look like a real person. The avatar and stats stay as they are;
--  past games show the new name (they reference the opponent by id). Additive: one new function.
create or replace function public.admin_virtual_rename(p_id uuid, p_nickname text, p_reason text) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := public._admin_require('virtual.manage'); r text := public._need_reason(p_reason);
        nn text := btrim(coalesce(p_nickname, '')); old text;
begin
  if nn !~ '^[^[:space:]]{3,20}$' then raise exception 'bad name'; end if;
  select nickname into old from public.virtual_players where id = p_id for update;
  if not found then raise exception 'not found'; end if;
  if old = nn then return json_build_object('ok', true, 'nickname', nn); end if;
  if exists (select 1 from public.virtual_players where lower(nickname) = lower(nn) and id <> p_id) then raise exception 'name taken'; end if;
  if exists (select 1 from public.profiles where lower(username) = lower(nn)) then raise exception 'name taken'; end if;
  update public.virtual_players set nickname = nn where id = p_id;
  perform public._audit(uid, 'virtual.rename', 'virtual', p_id::text, r, jsonb_build_object('before', old, 'after', nn));
  return json_build_object('ok', true, 'nickname', nn);
end $$;
revoke all on function public.admin_virtual_rename(uuid, text, text) from public, anon;
grant execute on function public.admin_virtual_rename(uuid, text, text) to authenticated;
