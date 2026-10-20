import { textDirection } from '@vertex-mizan/i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DirectionProvider } from '../src/index';
import { Preview } from './preview';
import './preview.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <DirectionProvider direction={textDirection}>
        <Preview />
      </DirectionProvider>
    </StrictMode>,
  );
}
