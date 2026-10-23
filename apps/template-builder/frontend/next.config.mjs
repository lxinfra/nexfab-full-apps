// BUILD_TARGET=static builds a plain folder of files for a static host such as
// Netlify (see scripts/build-static.mjs); otherwise the app runs as a Node server.
const staticSite = process.env.BUILD_TARGET === "static";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Served at the domain root in the shared Render deployment (its API is
  // reached through config.js, so no path prefix is needed for this app).
  ...(staticSite
    ? // every page becomes page/index.html, which any static host serves as /page/
      { output: "export", trailingSlash: true, images: { unoptimized: true } }
    : {
        // Standalone output keeps the Docker image small.
        output: "standalone",
        // links from before the editor moved to /editor?id=…
        redirects: async () => [
          { source: "/templates/:id", destination: "/editor?id=:id", permanent: false },
        ],
      }),
};

export default nextConfig;
