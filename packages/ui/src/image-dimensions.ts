/** Inspect raster headers before asking the browser to allocate decoded pixels. */
export function imageDimensions(bytes:Uint8Array):{width:number;height:number}{
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
  const text=(start:number,length:number)=>String.fromCharCode(...bytes.subarray(start,start+length))
  if(bytes.length>=24&&bytes[0]===137&&text(1,3)==='PNG'){
    for(let offset=8;offset+12<=bytes.length;){
      const length=view.getUint32(offset)
      if(text(offset+4,4)==='acTL')throw new Error('Choose a non-animated photo.')
      if(length>bytes.length-offset-12)break
      offset+=12+length
    }
    return{width:view.getUint32(16),height:view.getUint32(20)}
  }
  if(bytes.length>=30&&text(0,4)==='RIFF'&&text(8,4)==='WEBP'){
    const type=text(12,4),uint24=(offset:number)=>bytes[offset]!+256*bytes[offset+1]!+65536*bytes[offset+2]!
    if(type==='VP8X'){
      if(bytes[20]!&2)throw new Error('Choose a non-animated photo.')
      return{width:1+uint24(24),height:1+uint24(27)}
    }
    if(type==='VP8 '&&bytes.length>=30)return{width:view.getUint16(26,true)&0x3fff,height:view.getUint16(28,true)&0x3fff}
    if(type==='VP8L'&&bytes[20]===0x2f){
      const bits=view.getUint32(21,true)
      return{width:1+(bits&0x3fff),height:1+((bits>>>14)&0x3fff)}
    }
  }
  if(bytes[0]===255&&bytes[1]===216){
    let offset=2
    while(offset+4<=bytes.length){
      if(bytes[offset++]!==255)break
      while(bytes[offset]===255)offset++
      const marker=bytes[offset++]!
      if(marker===0xda||marker===0xd9)break
      if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue
      const length=view.getUint16(offset)
      if(length<2||offset+length>bytes.length)break
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&length>=7)return{height:view.getUint16(offset+3),width:view.getUint16(offset+5)}
      offset+=length
    }
  }
  throw new Error('Choose a valid JPEG, PNG or WebP photo.')
}
