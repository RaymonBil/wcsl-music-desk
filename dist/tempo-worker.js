import {estimateTempo} from './tempo-core.js';
self.onmessage = ({data}) => {try{self.postMessage({result:estimateTempo(data.samples,data.rate)});}catch(e){self.postMessage({error:e.message});}};
