import React from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { walletConfig } from "./wallet";
import App from "./App";
import "./styles.css";
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});
class Boundary extends React.Component<
  { children: React.ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="fatal">
        <h1>Stratoks could not open</h1>
        <p>
          Reload to retry. Your shared world is still running on its server.
        </p>
        <button onClick={() => location.reload()}>Reload Stratoks</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <Boundary>
    <WagmiProvider config={walletConfig}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </Boundary>,
);
