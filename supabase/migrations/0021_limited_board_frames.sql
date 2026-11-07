-- DAMEO 0021 (v3.2): the Limited boards' own ornamental frames in game.
-- Adds two keys to each Limited board's style: `fr` (frame image boards/<slug>-frame.webp, cut from the board's artwork
-- with a transparent opening) and `fi` (where the opening is, as fractions of the image). The client draws the real
-- 8x8 board inside the opening. Only the `style` of the 8 Limited boards changes; no other row or table is touched.
update public.shop_items i set style = i.style || v.extra, updated_at = now()
from (values
  ('midnight-blue', '{"fr": "midnight-blue-frame", "fi": [0.0762, 0.1348, 0.9238, 0.9043]}'::jsonb),
  ('graphite', '{"fr": "graphite-frame", "fi": [0.084, 0.1348, 0.916, 0.9004]}'::jsonb),
  ('royal-wood', '{"fr": "royal-wood-frame", "fi": [0.0801, 0.1348, 0.9121, 0.9043]}'::jsonb),
  ('emerald-board', '{"fr": "emerald-board-frame", "fi": [0.0859, 0.1387, 0.9082, 0.8965]}'::jsonb),
  ('cyber-purple', '{"fr": "cyber-purple-frame", "fi": [0.0762, 0.1348, 0.9121, 0.9004]}'::jsonb),
  ('royal-marble', '{"fr": "royal-marble-frame", "fi": [0.1152, 0.1309, 0.8887, 0.9043]}'::jsonb),
  ('obsidian-gold', '{"fr": "obsidian-gold-frame", "fi": [0.1035, 0.1426, 0.8965, 0.873]}'::jsonb),
  ('celestial-crown', '{"fr": "celestial-crown-frame", "fi": [0.1152, 0.1855, 0.8789, 0.877]}'::jsonb)
) as v(slug, extra)
where i.slug = v.slug and i.collection = 'limited';
