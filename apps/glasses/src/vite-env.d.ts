/** Vite's `?raw` import, used by the render-mode test to read a module's source. */
declare module '*?raw' {
  const content: string;
  export default content;
}

interface ImportMetaEnv {
  /** Relay used when the page is not served by the relay (QR sideload / dev). */
  readonly VITE_RELAY_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
