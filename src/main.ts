import './styles/global.css';
import { ArcadeMachine } from './core/ArcadeMachine';

declare global {
  interface Window {
    __RETRO_ARCADE__?: ArcadeMachine;
  }
}

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Retro Arcade root element was not found.');

window.__RETRO_ARCADE__?.destroy();
window.__RETRO_ARCADE__ = new ArcadeMachine(root);
