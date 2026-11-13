-- DAMEO 0037: gift_order_notice also returns notified_at (the admin "send the buyer's message again" button needs it).
create or replace function public.gift_order_notice(p_order bigint) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('id', o.id, 'code', o.code, 'gift', o.gift_id, 'gift_title', g.title_uz, 'emoji', g.emoji, 'price', o.price,
           'tg_id', o.tg_id::text, 'tg_username', o.tg_username, 'player', p.username, 'user_id', o.user_id, 'created_at', o.created_at,
           'status', o.status, 'delivered_at', o.delivered_at, 'delivered_by', a.username, 'notified_at', o.notified_at,
           'channel_chat_id', o.channel_chat_id::text, 'channel_msg_id', o.channel_msg_id,
           'target_chat_id', (select s.orders_chat_id::text from public.gift_settings s where s.id))
  from public.gift_orders o join public.gift_catalog g on g.id = o.gift_id join public.profiles p on p.id = o.user_id
  left join public.profiles a on a.id = o.delivered_by
  where o.id = p_order;
$$;
