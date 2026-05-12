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

const MapDashboard = lazy(() => import("@/pages/MapDashboard"));
const UploaderStatsPage = lazy(() => import("@/pages/UploaderStatsPage"));

const queryClient = new QueryClient();

function PageFallback() {
  return <div className="min-h-screen" />;
}

function L<P extends object>(Cmp: ComponentType<P>) {
  return (props: P) => (
    <Suspense fallback={<PageFallback />}>
      <Cmp {...props} />
    </Suspense>
  );
}

const LMapDashboard = L(MapDashboard);
const LUploaderStatsPage = L(UploaderStatsPage);

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomePage} />

      <Route path="/pryan">
        <RouteGuard roles={["viewer", "admin"]}>
          <Layout>
            <LMapDashboard />
          </Layout>
        </RouteGuard>
      </Route>

      <Route path="/uploader">
        <RouteGuard roles={["uploader", "admin"]}>
          <LUploaderStatsPage />
        </RouteGuard>
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
