/// <reference types="vite/client" />

// Vite CSS module imports
declare module '*.css?url' {
  const url: string
  export default url
}
