import './style.css';
import { App } from './app';

const canvas = document.getElementById('viewer-canvas');

if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Expected #viewer-canvas to be a <canvas> element.');
}

new App(canvas);
