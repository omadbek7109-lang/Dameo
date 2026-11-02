import { useSyncExternalStore } from 'react';

/** One main menu for the whole app: opened from the header avatar and from the "Profil" tab. */
let open = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export const openMainMenu = () => {
  if (!open) {
    open = true;
    emit();
  }
};
export const closeMainMenu = () => {
  if (open) {
    open = false;
    emit();
  }
};
export const useMainMenuOpen = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => open,
    () => false,
  );
