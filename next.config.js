/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [
      'pg', 'mammoth', '@xenova/transformers', 'onnxruntime-node',
      'tesseract.js', '@napi-rs/canvas', 'pdfjs-dist', 'adm-zip',
    ],
  },
};

module.exports = nextConfig;
