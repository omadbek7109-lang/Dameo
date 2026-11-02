// Sandbox-only shim so `tsc` can run without @types/react (registry unreachable here).
// On a normal machine `bun install` brings the real @types and this file is not used.
declare namespace JSX {
  interface IntrinsicAttributes { key?: any }
  interface IntrinsicElements { [k: string]: { [p: string]: any; onChange?: (e: any) => void; onClick?: (e: any) => void; onSubmit?: (e: any) => void; onKeyDown?: (e: any) => void; onMouseDown?: (e: any) => void; onFocus?: (e: any) => void } }
  interface Element {}
  interface ElementChildrenAttribute { children: {} }
}
declare module 'react/jsx-runtime' { export const jsx: any; export const jsxs: any; export const Fragment: any; }
declare module 'react' {
  export type ReactNode = any;
  export type RefObject<T> = { current: T };
  export type FormEvent = any; export type MouseEvent = any;
  export type SVGAttributes<T> = { [k: string]: any };
  export type CSSProperties = { [k: string]: any };
  export type AnchorHTMLAttributes<T> = { [k: string]: any };
  export namespace JSX { interface Element {} }
  export interface Context<T> { Provider: any; _t?: T }
  export function createContext<T>(d: T): Context<T>;
  export function useContext<T>(c: Context<T>): T;
  export function useState<S>(i: S | (() => S)): [S, (v: S | ((p: S) => S)) => void];
  export function useEffect(f: () => void | (() => void), d?: unknown[]): void;
  export function useSyncExternalStore<T>(subscribe: (onChange: () => void) => () => void, get: () => T, getServer?: () => T): T;
  export function useRef<T>(i: T): { current: T };
  export function useRef<T>(i: T | null): { current: T | null };
  export function useMemo<T>(f: () => T, d: unknown[]): T;
  export function useCallback<T extends (...a: any[]) => any>(f: T, d: unknown[]): T;
  export function useId(): string;
  export function memo<T>(c: T): T;
  export const StrictMode: any;
}
declare module 'react-dom/client' { export function createRoot(e: any): { render(n: any): void }; }
declare module 'react-dom' { export function createPortal(children: any, container: Element): any; }
declare namespace React { type RefObject<T> = { current: T }; type ReactNode = any }
