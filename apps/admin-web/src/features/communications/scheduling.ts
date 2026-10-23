/** Community wall times are independent of the administrator's device timezone. */
export function communityDateTimeInput(date:Date,timeZone:string){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date)
  const value=(type:string)=>parts.find((part)=>part.type===type)?.value??''
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`
}
export function communityDateTimeToIso(value:string,timeZone:string){
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw new Error('Choose a valid community date and time.')
  const wall=Date.parse(value+'Z')
  if(!Number.isFinite(wall)||new Date(wall).toISOString().slice(0,16)!==value)throw new Error('Choose a valid community date and time.')
  const offsets=new Set<number>()
  // Sample both sides of any timezone transition near the selected wall time.
  for(let hours=-36;hours<=36;hours+=6){const instant=wall+hours*3600000;offsets.add(Date.parse(communityDateTimeInput(new Date(instant),timeZone)+'Z')-instant)}
  const candidates=[...offsets].map((offset)=>wall-offset).filter((instant)=>communityDateTimeInput(new Date(instant),timeZone)===value)
  if(candidates.length!==1)throw new Error(candidates.length?'This community time occurs twice during a clock change. Choose a different time.':'This community time does not exist during a clock change. Choose a different time.')
  return new Date(candidates[0]).toISOString()
}
