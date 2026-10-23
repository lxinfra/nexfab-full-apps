const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');

const root = __dirname;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const python = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
const apps = [
  { name: 'Salary Slip Maker', dir: 'apps/salary-slip', port: process.env.SALARY_PORT || '3101', python: false },
  { name: 'Bill Generator', dir: 'apps/bill-generator', port: process.env.BILL_PORT || '3102', python: false },
  { name: 'Template Builder', dir: 'apps/template-builder/frontend', port: process.env.TEMPLATE_PORT || '3103', python: false },
];
function run(command, args, cwd, env=process.env) {
  const result = spawnSync(command,args,{cwd:path.join(root,cwd),env,stdio:'inherit',shell:process.platform==='win32'});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
const action=process.argv[2];
if (action==='install') {
  for(const app of apps) run(npm,['install','--no-audit','--no-fund'],app.dir);
  console.log('Install Python separately with: python -m pip install -r apps/template-builder/backend/requirements.txt');
} else if (action==='build') {
  for(const app of apps) {
    const dir=path.join(root,app.dir);
    if(app.name==='Salary Slip Maker') run(npm,['exec','prisma','generate'],app.dir);
    if(app.name==='Bill Generator') run(npm,['exec','prisma','generate'],app.dir);
    run(npm,['run','build'],app.dir,{...process.env,PORT:app.port});
  }
} else if (action==='start') {
  const children=[];
  function stop(code=0){for(const child of children) if(!child.killed) child.kill('SIGTERM');process.exitCode=code;}
  process.on('SIGINT',()=>stop(0)); process.on('SIGTERM',()=>stop(0));
  for(const app of apps){
    const child=spawn(npm,['start'],{cwd:path.join(root,app.dir),env:{...process.env,PORT:app.port,HOSTNAME:'127.0.0.1'},stdio:'inherit',shell:process.platform==='win32'});
    child.on('error',e=>{console.error(`${app.name}: ${e.message}`);stop(1)}); child.on('exit',code=>{if(code!==null&&code!==0){console.error(`${app.name} exited with code ${code}`);stop(code||1)}});children.push(child);
  }
  const backend=spawn(python,['-m','uvicorn','app.main:app','--host',process.env.TEMPLATE_API_HOST||'127.0.0.1','--port',process.env.TEMPLATE_API_PORT||'8000'],{cwd:path.join(root,'apps/template-builder/backend'),env:process.env,stdio:'inherit'});
  backend.on('error',e=>{console.error(`Template Builder backend: ${e.message}`);stop(1)});backend.on('exit',code=>{if(code!==null&&code!==0){console.error(`Template Builder backend exited with code ${code}`);stop(code||1)}});children.push(backend);
  console.log('Services started: salary slip :3101, bill generator :3102, template builder :3103, template API :8000 (localhost only). Use a reverse proxy and HTTPS for public access.');
} else {
  console.log('Usage: node deploy-all.js install | build | start'); process.exitCode=2;
}
