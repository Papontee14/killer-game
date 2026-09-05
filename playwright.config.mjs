import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser',workers:1,timeout:45000,
  use:{baseURL:'http://127.0.0.1:3107',...devices['Pixel 7'],serviceWorkers:'block',
    launchOptions:{args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']}},
  webServer:{command:'npm run dev -- --hostname 127.0.0.1 --port 3107',url:'http://127.0.0.1:3107',timeout:120000,
    env:{NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54329',NEXT_PUBLIC_SUPABASE_ANON_KEY:'test-anon-key',NEXT_DIST_DIR:'.next-role-tests'}},
});
