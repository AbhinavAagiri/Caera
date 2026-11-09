import '@fontsource-variable/instrument-sans/index.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource-variable/azeret-mono/index.css';
import './styles/globals.css';
import './styles/redesign.css';
import './styles/clean.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ToastProvider } from './components/ui/Toast';
import { ActivityProvider } from './contexts/ActivityContext';
import { LocalNodeProvider } from './contexts/LocalNodeContext';
import { PreferencesProvider } from './contexts/PreferencesContext';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root container');

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <PreferencesProvider>
        <ToastProvider>
          <LocalNodeProvider>
            <ActivityProvider>
              <App />
            </ActivityProvider>
          </LocalNodeProvider>
        </ToastProvider>
      </PreferencesProvider>
    </BrowserRouter>
  </StrictMode>,
);
