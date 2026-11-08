import { db } from './supabase.ts';

/**
 * Avatar frames.
 *  - free: 'dameo' (Classic, anyone) and 'champion' (only while the player is #1 of the rating — checked by the server),
 *  - Profile Frames collection: artwork rings sold for coins (prices from the admin panel), images in /frames/<slug>.webp.
 * Ownership and the equipped frame live on the server; the client never decides either.
 */
export type FrameId = string;
export const FREE_FRAMES = ['dameo', 'champion'] as const;
export const ART_FRAMES = ['crimson-queen', 'mystic-blossom', 'frost-guardian', 'golden-legend', 'dragon-fury'] as const;
export const isArtFrame = (f: string | null | undefined): f is string => !!f && (ART_FRAMES as readonly string[]).includes(f);
export interface FrameItem {
  slug: string;
  name_uz: string;
  name_en: string;
  price: number;
  owned: boolean;
}
export const framesActive = () => db.rpc<Array<{ user_id: string; frame: FrameId }>>('frames_active');
export const framesMine = () => db.rpc<{ equipped: FrameId | null; champion_ok: boolean; owned?: string[] }>('frames_mine');
export const frameEquip = (frame: FrameId | null) => db.rpc<{ ok: boolean; equipped: FrameId | null }>('frame_equip', { p_frame: frame });
export const frameCatalog = () => db.rpc<FrameItem[]>('frame_catalog');
export const frameBuy = (slug: string, key: string) => db.rpc<{ ok: boolean; balance: number; duplicate?: boolean }>('frame_buy', { p_slug: slug, p_key: key });
