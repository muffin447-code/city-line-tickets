import {randomBytes} from 'node:crypto';
import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
try {
  await writeFile(path.join(root,'.env'),[
    'CITYLINE_BRIDGE_TOKEN='+randomBytes(32).toString('base64url'),
    'CITYLINE_PORT=8787','CITYLINE_DATA_DIR=.data',
    'CITYLINE_PROFILE_PATH=config/cityline.local.json','CITYLINE_ALLOW_LIVE=false',''
  ].join('\n'),{flag:'wx',mode:0o600});
  console.log('已生成本机配置 .env（不会输出密钥）。');
} catch(e){if(e.code==='EEXIST') console.log('已保留现有 .env。');else throw e;}
await mkdir(path.join(root,'config'),{recursive:true});
try {
  await copyFile(path.join(root,'config/cityline.example.json'),path.join(root,'config/cityline.local.json'),constants.COPYFILE_EXCL);
  console.log('已生成未核实的本机网站配置，真实模式保持关闭。');
}catch(e){if(e.code!=='EEXIST')throw e;}
console.log('下一步：npm run demo；或 npm start。GPT/Codex 接入见 README。');
