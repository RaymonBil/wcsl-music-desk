import {normalizeSpeed} from './library-core.js';
export function applyPlaybackSpeed(audio,speed){
 const rate=normalizeSpeed(speed);
 audio.preservesPitch=true;
 audio.mozPreservesPitch=true;
 audio.webkitPreservesPitch=true;
 audio.defaultPlaybackRate=rate;
 audio.playbackRate=rate;
 return rate;
}
