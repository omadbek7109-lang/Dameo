-- DAMEO 0036: faster row-level security — same rules, auth.uid() evaluated once per query instead of once per row
-- (Supabase advisor "auth_rls_initplan"). Every policy below keeps exactly the logic it had in production; only
-- auth.uid() is wrapped as (select auth.uid()). Realtime's per-change permission checks get cheaper as well.
alter policy challenges_read_own on public.challenges using ((((select auth.uid()) = from_id) OR ((select auth.uid()) = to_id)));
alter policy friendships_read on public.friendships using ((((select auth.uid()) = requester_id) OR ((select auth.uid()) = addressee_id)));
alter policy invites_read on public.game_invites using ((((select auth.uid()) = from_id) OR ((select auth.uid()) = to_id)));
alter policy live_chat_read on public.live_chat_messages using (((NOT hidden) AND (EXISTS ( SELECT 1
   FROM matches m
  WHERE ((m.id = live_chat_messages.match_id) AND m.is_public AND ((m.status <> 'active'::text) OR ((select auth.uid()) IS NULL) OR (((select auth.uid()) <> m.white_id) AND ((select auth.uid()) <> COALESCE(m.black_id, m.white_id)))))))));
alter policy match_chat_players on public.match_chat_messages using (((EXISTS ( SELECT 1
   FROM matches m
  WHERE ((m.id = match_chat_messages.match_id) AND (((select auth.uid()) = m.white_id) OR ((select auth.uid()) = m.black_id))))) AND (NOT (EXISTS ( SELECT 1
   FROM user_blocks b
  WHERE ((b.blocker_id = (select auth.uid())) AND (b.blocked_id = match_chat_messages.user_id) AND (b.created_at > '1970-01-01 00:00:00+00'::timestamp with time zone)))))));
alter policy match_moves_read on public.match_moves using ((EXISTS ( SELECT 1
   FROM matches m
  WHERE ((m.id = match_moves.match_id) AND (((m.status = ANY (ARRAY['active'::text, 'finished'::text])) AND m.is_public) OR (((select auth.uid()) = m.white_id) OR ((select auth.uid()) = m.black_id)))))));
alter policy matches_read on public.matches using ((((status = ANY (ARRAY['active'::text, 'finished'::text])) AND is_public) OR (white_id = (select auth.uid())) OR (black_id = (select auth.uid()))));
alter policy payment_orders_own on public.payment_orders using ((user_id = (select auth.uid())));
alter policy profiles_update_own on public.profiles using ((id = (select auth.uid()))) with check ((id = (select auth.uid())));
alter policy reports_own on public.reports using ((reporter_id = (select auth.uid())));
alter policy shop_purchases_own on public.shop_purchases using ((user_id = (select auth.uid())));
alter policy registrations_read_own on public.tournament_registrations using ((user_id = (select auth.uid())));
alter policy user_achievements_own on public.user_achievements using ((user_id = (select auth.uid())));
alter policy user_blocks_own on public.user_blocks using ((blocker_id = (select auth.uid())));
alter policy user_inventory_own on public.user_inventory using ((user_id = (select auth.uid())));
alter policy user_notifications_own on public.user_notifications using ((user_id = (select auth.uid())));
alter policy user_wallets_own on public.user_wallets using ((user_id = (select auth.uid())));
alter policy wallet_tx_own on public.wallet_transactions using ((user_id = (select auth.uid())));
