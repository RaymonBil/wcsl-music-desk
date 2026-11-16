export const DEFAULT_PLAYLISTS = [
 ['warmup','Canciones de calentamiento','Selección manual para empezar la clase.'],
 ['exercises','Canciones para ejercicios en clase','Temas para practicar patrones, conexión y musicalidad.'],
 ['class-social','Canciones para sociales en clase','Música para bailar al terminar la clase.'],
 ['event-social','Sociales en eventos','Selección para encuentros y eventos.'],
 ['slow','Canciones de tempo lento','Tu selección manual de canciones lentas.'],
 ['medium','Canciones de tempo medio','Tu selección manual de canciones de velocidad media.'],
 ['high','Canciones de tempo alto','Tu selección manual de canciones de velocidad alta.'],
 ['fast','Canciones rápidas','Tu selección manual de canciones rápidas.']
].map(([id,name,description],i)=>({id:'default-'+id,name,description,trackIds:[],created:i+1}));
export function addToPlaylist(list, ids){return {...list,trackIds:[...new Set([...list.trackIds,...ids])]};}
export function removeFromPlaylist(list, ids){const set=new Set(ids);return {...list,trackIds:list.trackIds.filter(id=>!set.has(id))};}
export function moveInPlaylist(list,id,direction){const trackIds=[...list.trackIds],i=trackIds.indexOf(id),next=i+direction;if(i<0||next<0||next>=trackIds.length)return list;[trackIds[i],trackIds[next]]=[trackIds[next],trackIds[i]];return {...list,trackIds};}
export function correctReportedDoubleTempo(track){
 const titles=String(track.title||'').split(' - ').map(s=>s.toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g,'').replace(/^\s*\d+[.\s_-]+/,'').trim());
 if(!titles.some(t=>t==='grow up'||t==='cool')||track.bpmSource==='manual'||track.bpm<170||track.bpm>220||track.bpmCorrectionVersion===1)return track;
 return {...track,rawBpm:track.rawBpm||track.bpm,bpm:Math.round(track.bpm/2*10)/10,bpmCorrectionVersion:1,bpmCorrection:'Pulso de baile ajustado (÷2)'};
}
export function cleanTrack(record){return {...record,secondaryGenres:Array.isArray(record.secondaryGenres)?record.secondaryGenres:[],tags:Array.isArray(record.tags)?record.tags:[],notes:record.notes||'',genre:record.genre||''};}
export function sanitizePlaylist(record){if(!record||typeof record.name!=='string'||!Array.isArray(record.trackIds))return null;return {id:String(record.id||'').slice(0,100),name:record.name.slice(0,100),description:String(record.description||'').slice(0,1000),trackIds:[...new Set(record.trackIds.filter(id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id)))],created:Number(record.created)||Date.now()};}
