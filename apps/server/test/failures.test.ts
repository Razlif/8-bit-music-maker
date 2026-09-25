import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Library} from '../src/library.js';
const exec=promisify(execFile);
it('reports a post-save Git failure, blocks later writes, and reconciles once without another revision',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'chip-git-failure-'));let failing=false;
 const git=(async(file:string,args:string[],options:any)=>{if(failing&&args.includes('commit'))throw new Error('simulated git failure');return exec(file,args,options);}) as typeof exec;
 const lib=new Library(root,git);
 try{
  const s=await lib.create('before');failing=true;
  const result=await lib.update(s.id,x=>({...x,title:'after'}),0);expect(result.history).toBe('pending');expect(result.saved).toBe(true);expect((await lib.load(s.id)).title).toBe('after');
  await expect(lib.rename(s.id,'must not save',1)).rejects.toThrow(/HISTORY_PENDING/);
  failing=false;expect((await lib.retryHistory(s.id)).history).toBe('committed');expect((await lib.load(s.id)).revision).toBe(1);expect(await lib.history(s.id)).toHaveLength(2);
  await lib.retryHistory(s.id);expect(await lib.history(s.id)).toHaveLength(2);
 }finally{await lib.close();await fs.rm(root,{recursive:true,force:true});}
});
it('a failed canonical replacement leaves the previous accepted document intact',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'chip-write-failure-')),lib=new Library(root);
 try{
  const s=await lib.create();const original=fs.rename.bind(fs);
  const spy=vi.spyOn(fs,'rename').mockImplementation(async(a,b)=>{if(String(b).endsWith('song.json'))throw new Error('simulated write failure');return original(a,b);});
  try{await expect(lib.rename(s.id,'lost',0)).rejects.toThrow('simulated write failure');}finally{spy.mockRestore();}
  expect(await lib.load(s.id)).toEqual(s);expect(await lib.history(s.id)).toHaveLength(1);
 }finally{await lib.close();await fs.rm(root,{recursive:true,force:true});}
});
it('retries a transient Windows lock while checkpointing a run trace',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'chip-trace-lock-')),lib=new Library(root);
 try{
  const s=await lib.create(),runId=crypto.randomUUID(),original=fs.rename.bind(fs);let attempts=0;
  const spy=vi.spyOn(fs,'rename').mockImplementation(async(a,b)=>{
   if(String(b).includes('run-'+runId+'.json')&&attempts++<2){const e:any=new Error('locked');e.code='EPERM';throw e;}
   return original(a,b);
  });
  try{await lib.recordRun(s.id,runId,{ok:true});}finally{spy.mockRestore();}
  expect(attempts).toBe(3);
  expect(JSON.parse(await fs.readFile(path.join(root,s.id,'.local','run-'+runId+'.json'),'utf8'))).toEqual({ok:true});
 }finally{await lib.close();await fs.rm(root,{recursive:true,force:true});}
});
