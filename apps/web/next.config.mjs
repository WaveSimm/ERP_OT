/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  webpack: (config, { dev }) => {
    if (dev) {
      // Windows Docker 볼륨 마운트에서 HMR manifest 오염 방지
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
      };
    }
    return config;
  },
};

export default nextConfig;
