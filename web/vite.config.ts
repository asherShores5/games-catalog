import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The PWA service worker and manifest arrive with hosting (ticket 11), on Honey Do's pattern.
export default defineConfig({ plugins: [react()], build: { target: "es2022" } });
