import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('installed shell handles offline or temporary server failure without intercepting data requests', async()=>{
  const code=(await readFile(new URL('../public/sw.js',import.meta.url),'utf8')).replace('__LIFECASE_FILES__',"['./','./index.html']");
  const root='https://example.org/LifeCase/', handlers={};
  let online=false,status=503;
  const sandbox={URL,Response,self:{location:{href:root+'sw.js'},addEventListener:(name,fn)=>{handlers[name]=fn;}},
    caches:{open:async()=>({match:async url=>url===root?new Response('previous shell'):undefined})},
    fetch:async()=>{if (!online) throw Error('offline'); return new Response('server',{status});}};
  vm.runInNewContext(code,sandbox);
  const visit=async url=>{let result;handlers.fetch({request:{url,method:'GET',mode:'navigate'},respondWith:p=>{result=p;}});return result;};
  assert.equal(await (await visit(root)).text(),'previous shell');
  online=true;assert.equal(await (await visit(root)).text(),'previous shell');
  status=200;assert.equal(await (await visit(root)).text(),'server');
  assert.equal(await visit('https://example.org/rest/v1/records'),undefined);
});
