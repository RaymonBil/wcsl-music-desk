// Tempo estimation from positive RMS energy changes. No network or learned model.
export function estimateTempo(samples, sampleRate) {
  const hop = Math.max(1, Math.round(sampleRate / 200));
  const rate = sampleRate / hop;
  const envelope=[];
  let previous=0, mean=0;
  for(let i=0;i+hop<samples.length;i+=hop){
    let energy=0;
    for(let j=0;j<hop;j++)energy+=samples[i+j]*samples[i+j];
    const rms=Math.sqrt(energy/hop);
    mean+=rms;
    envelope.push(Math.max(0,rms-previous));
    previous=rms;
  }
  if(envelope.length<rate*8 || mean/envelope.length<0.0001)return null;
  // Remove slowly varying onset background and normalize isolated transients.
  const onset = new Float32Array(envelope.length);
  let rolling=0;
  for(let i=0;i<envelope.length;i++){
    rolling+=envelope[i]; if(i>=200)rolling-=envelope[i-200];
    onset[i]=Math.max(0,envelope[i]-rolling/Math.min(i+1,200));
  }
  const low=Math.floor(rate*60/190), high=Math.ceil(rate*60/55);
  const correlation=new Float64Array(high*3+3);
  for(let lag=low;lag<correlation.length;lag++){
    let product=0,a=0,b=0;
    for(let i=lag;i<onset.length;i++){product+=onset[i]*onset[i-lag];a+=onset[i]*onset[i];b+=onset[i-lag]*onset[i-lag];}
    correlation[lag]=product/(Math.sqrt(a*b)+1e-12);
  }
  let best=0,score=-1;
  const peaks=[];
  for(let lag=low+1;lag<=high;lag++){
    if(correlation[lag]<correlation[lag-1]||correlation[lag]<correlation[lag+1])continue;
    const value=correlation[lag]+0.35*correlation[lag*2]+0.15*correlation[lag*3];
    peaks.push({lag,value});
    if(value>score){score=value;best=lag;}
  }
  // Prefer the shortest plausible beat interval to avoid subharmonic peaks.
  const plausible=peaks.filter(p=>p.value>=score*.8).sort((a,b)=>a.lag-b.lag);
  if(plausible.length)best=plausible[0].lag;
  if(!best||correlation[best]<0.08)return null;
  const l=correlation[best-1],c=correlation[best],r=correlation[best+1];
  const delta=Math.abs(l-2*c+r)>1e-10?Math.max(-.5,Math.min(.5,.5*(l-r)/(l-2*c+r))):0;
  const bpm=Math.round(60*rate/(best+delta)*10)/10;
  return {bpm, strength:Math.round(Math.min(1,c)*100), alternatives:peaks.sort((a,b)=>b.value-a.value).slice(0,3).map(p=>Math.round(60*rate/p.lag))};
}
