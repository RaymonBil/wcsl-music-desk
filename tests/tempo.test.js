import {test} from 'node:test';
import assert from 'node:assert/strict';
import {estimateTempo} from '../dist/tempo-core.js';
const sr=11025;
function pulses(bpm){const x=new Float32Array(sr*24);for(let beat=0;beat<24;beat+=60/bpm){const offset=Math.floor(beat*sr);for(let j=0;j<sr*.06&&offset+j<x.length;j++)x[offset+j]=Math.sin(2*Math.PI*90*j/sr)*Math.exp(-j/(sr*.012));}return x;}
for(const bpm of [70,85,95,100,110,120,145,175])test(`regular beat ${bpm} BPM`,()=>{const result=estimateTempo(pulses(bpm),sr);assert.ok(result);assert.ok(Math.abs(result.bpm-bpm)<1,`${result.bpm} instead of ${bpm}`);});
test('silence and short audio do not invent a tempo',()=>{assert.equal(estimateTempo(new Float32Array(sr*15),sr),null);assert.equal(estimateTempo(pulses(100).slice(0,sr*3),sr),null);});
