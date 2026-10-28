/** Vite's `?raw` import, used by the render-mode test to read a module's source. */
declare module '*?raw' {
  const content: string;
  export default content;
}

interface ImportMetaEnv {
  /** Relay used when the page is not served by the relay (QR sideload / dev). */
  readonly VITE_RELAY_URL?: string;
  /** `'1'` in packaged `.ehpk` builds (`.env.pack`): VITE_RELAY_URL beats the page origin. */
  readonly VITE_RELAY_PINNED?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
