import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const bootstrapPath = path.join(process.cwd(), 'assets/js/bootstrap.js');
let bootstrap = fs.readFileSync(bootstrapPath, 'utf8');
const before = `    app.onload = () => {
      setProgress('빠른 지도를 표시하는 중입니다.', 99);
      // Fallback for a runtime that never emits the interactive milestone.
      scheduleCanonicalLoad(loader);
    };`;
const after = `    app.onload = () => setProgress('빠른 지도를 표시하는 중입니다.', 99);`;
if (!bootstrap.includes(before)) throw new Error('Missing canonical-load fallback block');
bootstrap = bootstrap.replace(before, after);
fs.writeFileSync(bootstrapPath, bootstrap, 'utf8');
console.log('Canonical data is now gated strictly by pandolab:interactive.');
