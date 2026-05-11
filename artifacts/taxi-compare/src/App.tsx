import { lazy, Suspense, type ComponentType } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PwaInstallBanner } from "@/components/PwaInstallBanner";
import { RouteGuard } from "@/components/RouteGuard";
import Layout from "@/components/layout/Layout";
import HomePage from "@/pages/HomePage";
import NotFound from "@/pages/not-found";

// Все остальные страницы загружаем лениво — это даёт ~30 отдельных чанков
// (по одному на роут), благодаря чему первая загрузка `/` тянет только
// HomePage + общий vendor, а тяжёлые либы (leaflet, recharts, force-graph,
// exceljs) приезжают только когда пользователь реально открывает нужный
// раздел.
//
// HomePage и NotFound оставлены eager: HomePage — первый экран после `/`,
// NotFound — единственный фолбэк маршрутизатора и должен рендериться без
// дополнительного Suspense-flash.
//
// Layout тоже eager — он крошечный (Navbar/Footer обёртка) и используется
// только вокруг MapDashboard; ленивая загрузка Layout привела бы к двум
// последовательным Suspense-границам на /pryan.
//
// Для newstat-страниц используем `.then(m => ({ default: m.X }))`, потому
// что они экспортируются как named-exports, а React.lazy ждёт default.

// ─────────── /pryan + WB pages (default exports) ───────────
const MapDashboard = lazy(() => import("@/pages/MapDashboard"));
const UploaderStatsPage = lazy(() => import("@/pages/UploaderStatsPage"));
const WbDashboard = lazy(() => import("@/pages/WbDashboard"));
const WbClientsPage = lazy(() => import("@/pages/WbClientsPage"));
const WbDriversPage = lazy(() => import("@/pages/WbDriversPage"));
const WbNewDriversPage = lazy(() => import("@/pages/WbNewDriversPage"));
const WbHeatmapsPage = lazy(() => import("@/pages/WbHeatmapsPage"));
const WbEntityPage = lazy(() => import("@/pages/WbEntityPage"));
const WbPairPage = lazy(() => import("@/pages/WbPairPage"));
const WbFraudPage = lazy(() => import("@/pages/WbFraudPage"));
const WbFraudQueuePage = lazy(() => import("@/pages/WbFraudQueuePage"));
const WbTimelinePage = lazy(() => import("@/pages/WbTimelinePage"));
const WbGraphPage = lazy(() => import("@/pages/WbGraphPage"));
const WbFranchPage = lazy(() => import("@/pages/WbFranchPage"));
const WbCasesPage = lazy(() => import("@/pages/WbCasesPage"));
const WbCaseDetailPage = lazy(() => import("@/pages/WbCaseDetailPage"));
const WbDriverFraudReportPage = lazy(() =>
  import("@/pages/WbDriverFraudReportPage"),
);
const WbAdminUsersPage = lazy(() => import("@/pages/WbAdminUsersPage"));

// ─────────── Newstat pages (named exports) ───────────
const NewstatHomePage = lazy(() =>
  import("@/newstat/pages/NewstatHomePage").then((m) => ({
    default: m.NewstatHomePage,
  })),
);
const NewstatSettingsPage = lazy(() =>
  import("@/newstat/pages/NewstatSettingsPage").then((m) => ({
    default: m.NewstatSettingsPage,
  })),
);
const NewstatLoginPage = lazy(() =>
  import("@/newstat/pages/NewstatLoginPage").then((m) => ({
    default: m.NewstatLoginPage,
  })),
);
const NewstatUploadPage = lazy(() =>
  import("@/newstat/pages/NewstatUploadPage").then((m) => ({
    default: m.NewstatUploadPage,
  })),
);
const NewstatGuaranteePage = lazy(() =>
  import("@/newstat/pages/NewstatGuaranteePage").then((m) => ({
    default: m.NewstatGuaranteePage,
  })),
);
const NewstatRisksPage = lazy(() =>
  import("@/newstat/pages/NewstatRisksPage").then((m) => ({
    default: m.NewstatRisksPage,
  })),
);
const NewstatClientsRiskPage = lazy(() =>
  import("@/newstat/pages/NewstatClientsRiskPage").then((m) => ({
    default: m.NewstatClientsRiskPage,
  })),
);
const NewstatPairsRiskPage = lazy(() =>
  import("@/newstat/pages/NewstatPairsRiskPage").then((m) => ({
    default: m.NewstatPairsRiskPage,
  })),
);
const NewstatTicketsPage = lazy(() =>
  import("@/newstat/pages/NewstatTicketsPage").then((m) => ({
    default: m.NewstatTicketsPage,
  })),
);
const NewstatTicketDetailPage = lazy(() =>
  import("@/newstat/pages/NewstatTicketDetailPage").then((m) => ({
    default: m.NewstatTicketDetailPage,
  })),
);
const NewstatMlDisagreementsPage = lazy(() =>
  import("@/newstat/pages/NewstatMlDisagreementsPage").then((m) => ({
    default: m.NewstatMlDisagreementsPage,
  })),
);
const NewstatMlLabelingPage = lazy(() =>
  import("@/newstat/pages/NewstatMlLabelingPage").then((m) => ({
    default: m.NewstatMlLabelingPage,
  })),
);
const NewstatMlPage = lazy(() =>
  import("@/newstat/pages/NewstatMlPage").then((m) => ({
    default: m.NewstatMlPage,
  })),
);
const NewstatHiddenLinksPage = lazy(() =>
  import("@/newstat/pages/NewstatHiddenLinksPage").then((m) => ({
    default: m.NewstatHiddenLinksPage,
  })),
);
const NewstatGraphPage = lazy(() =>
  import("@/newstat/pages/NewstatGraphPage").then((m) => ({
    default: m.NewstatGraphPage,
  })),
);
const NewstatGraphClusterPage = lazy(() =>
  import("@/newstat/pages/NewstatGraphClusterPage").then((m) => ({
    default: m.NewstatGraphClusterPage,
  })),
);
const NewstatGraphNodePage = lazy(() =>
  import("@/newstat/pages/NewstatGraphNodePage").then((m) => ({
    default: m.NewstatGraphNodePage,
  })),
);
const NewstatWorkbenchPage = lazy(() =>
  import("@/newstat/pages/NewstatWorkbenchPage").then((m) => ({
    default: m.NewstatWorkbenchPage,
  })),
);
const NewstatAdminUsersPage = lazy(() =>
  import("@/newstat/pages/NewstatAdminUsersPage").then((m) => ({
    default: m.NewstatAdminUsersPage,
  })),
);

const queryClient = new QueryClient();

// Минималистичный fallback на время подгрузки чанка страницы. Намеренно
// без спиннера/текста — типичный чанк весит 50–200 КБ и грузится за
// 100–500 мс, мерцающий лоадер на такой длительности раздражает больше,
// чем кратковременная пустая область. Если страница тяжёлая (карта) —
// у неё внутри есть свои индикаторы прогресса.
function PageFallback() {
  return <div className="min-h-screen" />;
}

// Хелпер: оборачивает lazy-компонент в Suspense, чтобы не плодить
// `<Suspense>` на каждый Route. Принимает компонент и пропсы через
// generics — типобезопасно для роутов с params.
function L<P extends object>(Cmp: ComponentType<P>) {
  return (props: P) => (
    <Suspense fallback={<PageFallback />}>
      <Cmp {...props} />
    </Suspense>
  );
}

const LMapDashboard = L(MapDashboard);
const LUploaderStatsPage = L(UploaderStatsPage);
const LWbDashboard = L(WbDashboard);
const LWbClientsPage = L(WbClientsPage);
const LWbDriversPage = L(WbDriversPage);
const LWbNewDriversPage = L(WbNewDriversPage);
const LWbHeatmapsPage = L(WbHeatmapsPage);
const LWbEntityPage = L(WbEntityPage);
const LWbPairPage = L(WbPairPage);
const LWbFraudPage = L(WbFraudPage);
const LWbFraudQueuePage = L(WbFraudQueuePage);
const LWbTimelinePage = L(WbTimelinePage);
const LWbGraphPage = L(WbGraphPage);
const LWbFranchPage = L(WbFranchPage);
const LWbCasesPage = L(WbCasesPage);
const LWbCaseDetailPage = L(WbCaseDetailPage);
const LWbDriverFraudReportPage = L(WbDriverFraudReportPage);
const LWbAdminUsersPage = L(WbAdminUsersPage);
const LNewstatHomePage = L(NewstatHomePage);
const LNewstatSettingsPage = L(NewstatSettingsPage);
const LNewstatLoginPage = L(NewstatLoginPage);
const LNewstatUploadPage = L(NewstatUploadPage);
const LNewstatGuaranteePage = L(NewstatGuaranteePage);
const LNewstatRisksPage = L(NewstatRisksPage);
const LNewstatClientsRiskPage = L(NewstatClientsRiskPage);
const LNewstatPairsRiskPage = L(NewstatPairsRiskPage);
const LNewstatTicketsPage = L(NewstatTicketsPage);
const LNewstatTicketDetailPage = L(NewstatTicketDetailPage);
const LNewstatMlDisagreementsPage = L(NewstatMlDisagreementsPage);
const LNewstatMlLabelingPage = L(NewstatMlLabelingPage);
const LNewstatMlPage = L(NewstatMlPage);
const LNewstatHiddenLinksPage = L(NewstatHiddenLinksPage);
const LNewstatGraphPage = L(NewstatGraphPage);
const LNewstatGraphClusterPage = L(NewstatGraphClusterPage);
const LNewstatGraphNodePage = L(NewstatGraphNodePage);
const LNewstatWorkbenchPage = L(NewstatWorkbenchPage);
const LNewstatAdminUsersPage = L(NewstatAdminUsersPage);

function Router() {
  return (
    <Switch>
      {/* Главная — единая точка входа: форма логина + меню модулей по роли. */}
      <Route path="/" component={HomePage} />

      {/* Прогноз тарифов — viewer + admin. Layout c Navbar/Footer оставляем
          только здесь, чтобы карта выглядела как раньше. */}
      <Route path="/pryan">
        <RouteGuard roles={["viewer", "admin"]}>
          <Layout>
            <LMapDashboard />
          </Layout>
        </RouteGuard>
      </Route>

      {/* Личная страница загрузчика — большие счётчики, кнопка «загрузить
          скрины», ранг среди операторов. Доступна uploader/admin/antifraud. */}
      <Route path="/uploader">
        <RouteGuard roles={["uploader", "admin", "antifraud"]}>
          <LUploaderStatsPage />
        </RouteGuard>
      </Route>

      {/* ─── Newstat: новый изолированный модуль фрод-финансов ───
          Свой сервис на :3012, своя БД rwbtaxi_newstat, своя auth (в работе).
          Спроектирован так, чтобы при необходимости его можно было выдернуть
          в отдельный SPA на newstat.rwbtaxi.by или на другой домен. */}
      <Route path="/newstat" component={LNewstatHomePage} />
      <Route path="/newstat/login" component={LNewstatLoginPage} />
      <Route path="/newstat/settings" component={LNewstatSettingsPage} />
      <Route path="/newstat/upload" component={LNewstatUploadPage} />
      <Route path="/newstat/guarantee" component={LNewstatGuaranteePage} />
      <Route path="/newstat/risks" component={LNewstatRisksPage} />
      <Route path="/newstat/clients-risk" component={LNewstatClientsRiskPage} />
      <Route path="/newstat/pairs-risk" component={LNewstatPairsRiskPage} />
      <Route path="/newstat/tickets/:id" component={LNewstatTicketDetailPage} />
      <Route path="/newstat/tickets" component={LNewstatTicketsPage} />
      <Route
        path="/newstat/ml-disagreements"
        component={LNewstatMlDisagreementsPage}
      />
      <Route path="/newstat/ml-labeling" component={LNewstatMlLabelingPage} />
      <Route path="/newstat/ml" component={LNewstatMlPage} />
      <Route
        path="/newstat/graph/node/:type/:id"
        component={LNewstatGraphNodePage}
      />
      <Route
        path="/newstat/graph/:id"
        component={LNewstatGraphClusterPage}
      />
      <Route path="/newstat/hidden-links" component={LNewstatHiddenLinksPage} />
      <Route path="/newstat/graph" component={LNewstatGraphPage} />
      <Route path="/newstat/workbench" component={LNewstatWorkbenchPage} />
      <Route path="/newstat/admin/users" component={LNewstatAdminUsersPage} />

      {/* Антифрод-кейсы — доступны и админам, и антифродерам. WbShell внутри
          сам рисует ModuleHeader + WbNav. */}
      <Route path="/wb/cases">
        <RouteGuard roles={["admin", "antifraud"]}>
          <LWbCasesPage />
        </RouteGuard>
      </Route>
      <Route path="/wb/cases/:id">
        {(params) => (
          <RouteGuard roles={["admin", "antifraud"]}>
            <LWbCaseDetailPage id={params.id} />
          </RouteGuard>
        )}
      </Route>
      <Route path="/wb/driver-fraud-report">
        <RouteGuard roles={["admin", "antifraud"]}>
          <LWbDriverFraudReportPage />
        </RouteGuard>
      </Route>

      {/* Админ-разделы ВБ-статистики — только admin. */}
      <Route path="/wb">
        <RouteGuard roles={["admin"]}>
          <LWbDashboard />
        </RouteGuard>
      </Route>
      <Route path="/wb/clients">
        <RouteGuard roles={["admin"]}>
          <LWbClientsPage />
        </RouteGuard>
      </Route>
      <Route path="/wb/drivers">
        <RouteGuard roles={["admin"]}>
          <LWbDriversPage />
        </RouteGuard>
      </Route>
      <Route path="/wb/new-drivers">
        <RouteGuard roles={["admin"]}>
          <LWbNewDriversPage />
        </RouteGuard>
      </Route>
      <Route path="/wb/heatmaps">
        <RouteGuard roles={["admin"]}>
          <LWbHeatmapsPage />
        </RouteGuard>
      </Route>
      {/* Новый поток антифродера: очередь подозрительных водителей за период
          + быстрое решение → автопереход. Старая 4-вкладочная страница
          оставлена под /wb/fraud/legacy на случай отката. */}
      <Route path="/wb/fraud/legacy">
        <RouteGuard roles={["admin", "antifraud"]}>
          <LWbFraudPage />
        </RouteGuard>
      </Route>
      <Route path="/wb/fraud">
        <RouteGuard roles={["admin", "antifraud"]}>
          <LWbFraudQueuePage />
        </RouteGuard>
      </Route>
      <Route path="/wb/admin/users">
        <RouteGuard roles={["admin"]}>
          <LWbAdminUsersPage />
        </RouteGuard>
      </Route>
      <Route path="/wb/timeline">
        <RouteGuard roles={["admin"]}>
          <LWbTimelinePage />
        </RouteGuard>
      </Route>
      <Route path="/wb/graph">
        <RouteGuard roles={["admin"]}>
          <LWbGraphPage />
        </RouteGuard>
      </Route>
      <Route path="/wb/client/:id">
        {(params) => (
          <RouteGuard roles={["admin"]}>
            <LWbEntityPage kind="client" id={params.id} />
          </RouteGuard>
        )}
      </Route>
      <Route path="/wb/driver/:id">
        {(params) => (
          <RouteGuard roles={["admin"]}>
            <LWbEntityPage kind="driver" id={params.id} />
          </RouteGuard>
        )}
      </Route>
      <Route path="/wb/franch/:id">
        {(params) => (
          <RouteGuard roles={["admin"]}>
            <LWbFranchPage id={params.id} />
          </RouteGuard>
        )}
      </Route>
      <Route path="/wb/pair/:cid/:did">
        {(params) => (
          <RouteGuard roles={["admin"]}>
            <LWbPairPage clientId={params.cid} driverId={params.did} />
          </RouteGuard>
        )}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <PwaInstallBanner />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
