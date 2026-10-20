import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { boot } from './project/session';
import './styles/tokens.css';
import './styles/base.css';
import './styles/controls.css';
import './styles/library.css';
import './styles/workspace.css';
import './styles/overlay.css';
import './styles/transport.css';
import './styles/recording.css';

void boot();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
