import { db } from './supabase.ts';

/** Avatar frames — not sold. 'dameo': anyone; 'champion': only while the player is #1 of the rating (checked by the server). */
export type FrameId = 'champion' | 'dameo';
export const FRAMES: FrameId[] = ['dameo', 'champion'];
export const framesActive = () => db.rpc<Array<{ user_id: string; frame: FrameId }>>('frames_active');
export const framesMine = () => db.rpc<{ equipped: FrameId | null; champion_ok: boolean }>('frames_mine');
export const frameEquip = (frame: FrameId | null) => db.rpc<{ ok: boolean; equipped: FrameId | null }>('frame_equip', { p_frame: frame });
