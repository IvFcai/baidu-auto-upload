import { chromeLaunchConfiguration } from './chrome-check.js';

export function chromeLaunchOptions({ executablePath } = {}) {
  return {
    headless: false,
    ...chromeLaunchConfiguration({ executablePath }),
    viewport: null,
    args: ['--start-maximized']
  };
}
