/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['pg', 'pdf-parse', 'mammoth', '@xenova/transformers', 'onnxruntime-node'],
  },
};

module.exports = nextConfig;
