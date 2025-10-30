import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // TypeScript checking is now enabled - all errors fixed!
  typescript: {
    ignoreBuildErrors: false,
  },
  // React Compiler (requires babel-plugin-react-compiler package)
  // Uncomment after installing: npm install -D babel-plugin-react-compiler
  // reactCompiler: true,
  images: {
    // Replaced deprecated 'domains' with 'remotePatterns'
    remotePatterns: [
      // Add patterns here when using external images
      // Example: { protocol: 'https', hostname: '**.supabase.co' }
    ],
  },
};

export default nextConfig;
