import { defineConfig } from 'vite';

// Relative base so the same build works in Capacitor (iOS/Android),
// on any static host, and from a sub-path such as GitHub Pages.
export default defineConfig({ base: './' });
