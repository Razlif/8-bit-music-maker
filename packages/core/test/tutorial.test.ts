import {it,expect} from 'vitest';
import fs from 'node:fs';
import {newSong,parseNotation,compileRows,notationRoundTrip,validateSong} from '../src/index.js';
it('compiles and exactly round-trips all complete tutorial examples using the production adapter',()=>{
 const tutorial=fs.readFileSync('../../LANGUAGE-TUTORIAL.md','utf8');
 const examples=[...tutorial.matchAll(/```song (\w+)\r?\n([\s\S]*?)```/g)];expect(examples).toHaveLength(4);
 for(const [,name,text] of examples){
  const song=newSong(crypto.randomUUID());song.music.bars=Math.max(...[...text.matchAll(/^BAR (\d+)$/gm)].map(m=>Number(m[1])));
  song.music.tracks=[...text.matchAll(/^TRACK (\S+) \| instrument=(\S+)/gm)].map(([,id,instrumentId])=>({id,name:id,instrumentId,instrumentVersion:1,volumeDb:-12,muted:false,notes:[]}));
  const rows=parseNotation(text,new Map(song.music.tracks.map(t=>[t.id,t])));expect(rows.length).toBe(song.music.bars*4*song.music.tracks.length);
  const compiled=validateSong(compileRows(rows,song));expect(notationRoundTrip(compiled),name).toEqual(compiled);
 }
});
