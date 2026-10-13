import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // In development, forward API calls to the Express server.
    proxy: { '/api': { target: 'http://localhost:3000', ws: true } },
  },
});
