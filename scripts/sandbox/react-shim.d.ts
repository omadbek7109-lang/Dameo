// SANDBOX-ONLY typings used when @types/react cannot be installed (offline build machine).
// On a normal machine run `npm i` (devDependency @types/react) and use tsconfig.json instead.
interface RC<T> { Provider: (p: { value: T; children?: any }) => any }
declare module 'react' {
  export type ReactNode = any;
  export type FormEvent = any;
  export type ChangeEvent<T = any> = any;
  export type AnchorHTMLAttributes<T> = { [k: string]: any };
  export type RefObject<T> = { current: T };
  export type IconProps = any;
  export function useState<S>(i: S | (() => S)): [S, (v: S | ((p: S) => S)) => void];
  export function useEffect(f: () => void | (() => void), d?: readonly unknown[]): void;
  export function useMemo<T>(f: () => T, d: readonly unknown[]): T;
  export function useCallback<T extends (...a: any[]) => any>(f: T, d: readonly unknown[]): T;
  export function useRef<T>(i: T): { current: T };
  export function useRef<T>(i: T | null): { current: T | null };
  export function useId(): string;
  export function createContext<T>(d: T): RC<T> & { _t?: T };
  export function useContext<T>(c: RC<T>): T;
  export function memo<T>(c: T): T;
  export const StrictMode: any;
  export class Component<P = {}, S = {}> { props: P; state: S; constructor(p: P); setState(s: Partial<S>): void; }
}
declare namespace React {
  type ReactNode = any;
  type RefObject<T> = { current: T };
}
declare namespace JSX {
  interface Element {}
  interface IntrinsicElements { [k: string]: { [p: string]: any } }
}
declare module 'react/jsx-runtime' { export const jsx: any; export const jsxs: any; export const Fragment: any }
declare module 'react-dom/client' { export function createRoot(e: any): { render(n: any): void } }
