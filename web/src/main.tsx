import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

async function start() {
  // The public demo answers API calls in the browser from sample data (Q22).
  // In a normal build this branch is removed, along with the demo code.
  if (import.meta.env.VITE_DEMO === '1') {
    const { installDemoApi } = await import('./demo/demoApi');
    installDemoApi();
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
}

void start();

// Installable app with a quick start (#35). Not in development, where it would cache the dev server.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`));
}
