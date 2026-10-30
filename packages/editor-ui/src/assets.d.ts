// Asset module declarations. editor-ui is compiled both on its own (with
// vite/client types) and as source inside apps/desktop (without them), so we
// declare image imports here to keep both compilations happy.
declare module "*.png" {
  const src: string;
  export default src;
}
declare module "*.svg" {
  const src: string;
  export default src;
}
