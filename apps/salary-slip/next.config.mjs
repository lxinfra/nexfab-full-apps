/** @type {import('next').NextConfig} */
const nextConfig = {
  // Set at build time when the app is served under a path prefix (e.g. /salary
  // behind the shared Render reverse proxy). Empty locally.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  // The floating dev badge sits on top of the Save buttons at the bottom-left.
  devIndicators: false,
  serverExternalPackages: ["@react-pdf/renderer", "exceljs"],
  experimental: {
    // Company logos are uploaded through server actions.
    serverActions: { bodySizeLimit: "2mb" },
  },
  // Keep Prisma's query engine and the SQLite fallback present in the
  // standalone server bundle (npm run build:standalone / Docker).
  outputFileTracingIncludes: {
    "**/*": ["./node_modules/.prisma/**", "./node_modules/@prisma/engines/**", "./prisma/**"],
  },
};

export default nextConfig;
