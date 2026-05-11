import { createRoot } from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

// Регистрация service worker — нужен для установки PWA на главный экран.
// SW сам по себе ничего не кэширует, но без него браузер не предложит
// «Добавить на главный экран».
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* игнорируем — отсутствие SW не должно ломать приложение */
    });
  });
}
