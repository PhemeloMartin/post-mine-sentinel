import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { notify } from './store/toasts';
import './index.css';

// Last-resort handlers: async failures outside React render paths (promises, timers, workers)
// are logged as structured JSON and surfaced to the operator instead of failing silently.
window.addEventListener('unhandledrejection', (e) => {
  const message = e.reason instanceof Error ? e.reason.message : String(e.reason);
  console.error(JSON.stringify({ level: 'error', kind: 'unhandledrejection', message }));
  notify({ kind: 'error', title: 'Background task failed', detail: message });
});
window.addEventListener('error', (e) => {
  console.error(JSON.stringify({ level: 'error', kind: 'window.error', message: e.message, source: e.filename, line: e.lineno }));
});

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
