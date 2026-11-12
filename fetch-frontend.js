import fs from 'fs';
import path from 'path';

const BASE_URL = 'https://raw.githubusercontent.com/mustafa64-stack/vaultpal/main/static';
const files = ['index.html', 'style.css', 'app.js'];

async function download() {
  console.log('Downloading Mustafa frontend files from GitHub raw...');
  for (const file of files) {
    try {
      const url = `${BASE_URL}/${file}`;
      console.log('Fetching:', url);
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`Failed to fetch ${file}: ${res.status} ${res.statusText}`);
        continue;
      }
      const content = await res.text();
      fs.writeFileSync(path.join('public', file), content, 'utf-8');
      console.log(`✅ Saved public/${file} (${content.length} bytes)`);
    } catch (e) {
      console.error(`Error downloading ${file}:`, e.message);
    }
  }
}

download();
