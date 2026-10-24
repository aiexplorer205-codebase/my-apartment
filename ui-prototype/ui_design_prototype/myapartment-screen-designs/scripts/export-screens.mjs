import {build} from 'esbuild';
import {mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import React from 'react';
import {renderToString} from 'react-dom/server';
import {names} from '../src/screens.js';
await build({entryPoints:['src/App.jsx'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.screen-export.mjs'});
const {App}=await import('../.screen-export.mjs');
const css=readFileSync('src/tokens.css','utf8')+'\n'+readFileSync('src/styles.css','utf8').replace("@import './tokens.css';",'');
mkdirSync('frames',{recursive:true});
let links=[];
for(const [id,name] of Object.entries(names)){
 globalThis.location={hash:'#'+id};
 const markup=renderToString(React.createElement(App));
 if(!markup.includes('<code>'+id+'</code>'))throw Error('Missing screen heading '+id);
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="../"><title>${id} · ${name} · MyApartment</title><style>${css}</style></head><body>${markup}<p style="padding:20px;text-align:center">Static design frame · <a href="frames/index.html">All frames</a> · <a href="index.html#${id}">Interactive screen</a></p></body></html>`;
 writeFileSync(`frames/${id}.html`,html);links.push(`<a href="${id}.html"><b>${id}</b> ${name}</a>`);
}
writeFileSync('frames/index.html',`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MyApartment · 77 screen frames</title><style>body{font:16px Arial;color:#152337;background:#f5f7fa;padding:32px;max-width:1200px;margin:auto}nav{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}a{padding:18px;background:white;border:1px solid #e2e8f0;border-radius:10px;color:#087e88;text-decoration:none}h1{color:#173a65}p{line-height:1.6;color:#647185}</style><h1>MyApartment · Screen library</h1><p>77 responsive design frames based on the selected blue–teal reference. Resize a frame to view its mobile or desktop composition. Static controls are visual references; use the running React prototype for interactions. Proposed modules and simulated data are labeled outside the product UI.</p><nav>${links.join('')}</nav></html>`);
rmSync('.screen-export.mjs');
console.log(`Rendered and exported ${links.length} screens without server-render errors.`);
