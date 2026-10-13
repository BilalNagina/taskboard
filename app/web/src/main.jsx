import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import App from './App.jsx';
import { ToastProvider } from './components/Toaster.jsx';
import { queryClient } from './lib/queries.js';
import './styles/tokens.css';
import './styles/base.css';
import './styles/landing.css';
import './styles/auth.css';
import './styles/app.css';
import './styles/board.css';
import './styles/insights.css';
import './styles/planning.css';
import './styles/admin.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
