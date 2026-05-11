import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

// Прокидываем GOOGLE_MAPS_KEY в бандл как VITE_GOOGLE_MAPS_KEY, чтобы фронт
// мог опрашивать Google Routes API напрямую из браузера. Ключ ВСЁ РАВНО
// будет публичным — обязательно ограничьте его в Google Cloud Console
// по HTTP-referrer (rwbtaxi.by, *.replit.dev).
const googleMapsKey = process.env.GOOGLE_MAPS_KEY ?? "";

export default defineConfig({
  base: basePath,
  define: {
    "import.meta.env.VITE_GOOGLE_MAPS_KEY": JSON.stringify(googleMapsKey),
  },
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Поднимаем лимит warning'а: после route-level lazy самый крупный
    // entry-чанк ~300 КБ, vendor-чанки до 600 КБ — это ОК для нашего кейса
    // (один пользователь, статика на nginx с http/2 + immutable-кэш).
    // Исключение — xlsx (~940 КБ): сама ExcelJS большая, но она уже
    // изолирована в отдельный chunk и грузится lazy ТОЛЬКО при открытии
    // диалога экспорта в админке. Поэтому лимит 1100 — не зашумлять билд.
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        // Группируем тяжёлые либы в стабильные vendor-чанки. Идея:
        // route-level lazy в App.tsx уже даёт ~30 page-чанков; этот
        // manualChunks вытаскивает из них общие npm-зависимости в
        // долго-кэшируемые куски, чтобы повторные визиты не качали
        // одни и те же leaflet/recharts по второму разу.
        //
        // Решение функцией (а не объектом) нужно потому что часть либ
        // (leaflet.markercluster, h3-js) — не top-level зависимости, и
        // объектная форма не сматчит их через бандл.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          // Карты — самый тяжёлый кластер, грузится только на /pryan и /wb/heatmaps
          if (
            id.includes("/leaflet/") ||
            id.includes("/leaflet.markercluster/") ||
            id.includes("/react-leaflet/") ||
            id.includes("/@react-leaflet/") ||
            id.includes("/h3-js/")
          ) {
            return "maps";
          }
          // d3-* — общая зависимость и recharts (charts), и force-graph (graphviz).
          // КРИТИЧНО держать ОТДЕЛЬНЫМ chunk-ом, иначе при большом
          // использовании recharts (LineChart + кучи Line/Axis/Tooltip)
          // d3-color/scale/shape попадает в charts, а graphviz импортирует
          // их же → cyclic chunk import → "Cannot access 'Ln' before
          // initialization" (TDZ) на проде. Bug 2026-05-02 после T03.
          if (id.includes("/d3-") || id.includes("/internmap/") ||
              id.includes("/victory-vendor/")) {
            return "d3";
          }
          // Графики — recharts (без d3, оно в отдельном chunk выше)
          if (id.includes("/recharts/")) {
            return "charts";
          }
          // Force-graph — ОЧЕНЬ тяжёлый (force-graph + canvas), используется
          // только на /wb/graph и /newstat/graph. d3-force идёт в d3-чанк выше.
          if (
            id.includes("/react-force-graph") ||
            id.includes("/force-graph") ||
            id.includes("/canvas-color-tracker") ||
            id.includes("/kapsule")
          ) {
            return "graphviz";
          }
          // ExcelJS — подключается только в xlsx-export диалогах
          if (id.includes("/exceljs/")) {
            return "xlsx";
          }
          // Все Radix-примитивы — общий UI-каркас, всегда нужен
          if (id.includes("/@radix-ui/")) {
            return "radix";
          }
          // Иконки — lucide и react-icons могут весить >100 КБ при
          // широком использовании
          if (id.includes("/lucide-react/") || id.includes("/react-icons/")) {
            return "icons";
          }
          // Анимации
          if (id.includes("/framer-motion/")) {
            return "motion";
          }
          // Date utils
          if (id.includes("/date-fns/")) {
            return "date-fns";
          }
          // React core отдельно, чтобы кэшировался долго
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/scheduler/")
          ) {
            return "react-vendor";
          }
          // Остальное (wouter, react-query, zod, и т.п.) попадает в
          // дефолтный vendor-чанк, который Vite формирует сам.
          return undefined;
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
