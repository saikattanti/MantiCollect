/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: the renderer is a set of plain HTML/JS/CSS files that
  // Electron serves from the privileged mvault:// scheme (see electron/main.js).
  // No server features are used — all data comes from the main process over IPC.
  output: 'export',
  distDir: 'dist',
  trailingSlash: false,
  images: { unoptimized: true },
  reactStrictMode: true,
  // Dev only: Electron connects to the dev server over 127.0.0.1, which Next
  // treats as a cross-origin client for /_next dev resources (incl. HMR)
  // unless explicitly allowed.
  allowedDevOrigins: ['127.0.0.1', 'localhost']
};

export default nextConfig;
