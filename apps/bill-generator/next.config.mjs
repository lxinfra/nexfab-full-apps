/** @type {import('next').NextConfig} */
const nextConfig = {
  // Set at build time when the app is served under a path prefix (e.g. /bills
  // behind the shared Render reverse proxy). Empty locally.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  serverExternalPackages: ['@react-pdf/renderer', '@prisma/client', 'pdfjs-dist'],

  // These files are opened through paths built at runtime, so Next's automatic
  // tracing cannot see them and would leave them out of the serverless bundle.
  // Without them the PDF routes throw "unknown font format" and the bill
  // importer throws "fake worker failed" once deployed.
  outputFileTracingIncludes: {
    // The invoice PDF embeds Noto Sans for the rupee glyph.
    '/api/invoices/[id]/pdf': ['./public/fonts/**'],
    // The bill importer runs pdf.js, which loads its worker from disk.
    '/api/invoices/import': ['./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'],
    // Prisma needs its engines and migrations at runtime (Docker/standalone).
    '**/*': ['./node_modules/.prisma/**', './node_modules/@prisma/engines/**', './prisma/**'],
  },
};
export default nextConfig;
