/** Vite's `?raw` import, used by the render-mode test to read a module's source. */
declare module '*?raw' {
  const content: string;
  export default content;
}
