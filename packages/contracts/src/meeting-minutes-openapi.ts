const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const text = { type:'string' }
const instant = { type:'string',format:'date-time' }
const nullableInstant = { type:['string','null'],format:'date-time' }
const uuid = { type:'string',format:'uuid' }
const attendeeDisplay = { fullName:text,blockName:text,flatNumber:text }
const attendee = { type:'object',required:['residentId','unitId',...Object.keys(attendeeDisplay)],properties:{residentId:uuid,unitId:uuid,...attendeeDisplay} }
const summary = { id:uuid,title:text,meetingAt:nullableInstant,publishedAt:nullableInstant,status:{enum:['draft','published']},attendeeCount:{type:'integer',minimum:0} }
const detail = { ...summary,location:text,notes:text,timezone:text,attendanceNotRecorded:{type:'boolean'},attendees:{type:'array',items:{type:'object',required:Object.keys(attendeeDisplay),properties:attendeeDisplay}} }
const draft = {
  title:{type:'string',maxLength:160},meetingAt:nullableInstant,location:{type:'string',maxLength:200},notes:{type:'string',maxLength:20000},
  attendeeIds:{type:'array',maxItems:10000,uniqueItems:true,items:uuid},attendanceNotRecorded:{type:'boolean'},
}
export const meetingMinutesSchemas = {
  MeetingSummary:{type:'object',required:Object.keys(summary),properties:summary},
  MeetingDetail:{type:'object',required:Object.keys(detail),properties:detail},
  AdminMeetingDetail:{type:'object',required:[...Object.keys(detail),'version','reviewFingerprint'],properties:{...detail,attendees:{type:'array',items:attendee},version:{type:'integer',minimum:1},reviewFingerprint:{type:'string',pattern:'^[0-9a-f]{64}$'}}},
  MeetingDraftCreate:{type:'object',required:[...Object.keys(draft),'requestKey'],properties:{...draft,requestKey:uuid}},
  MeetingDraftUpdate:{type:'object',required:[...Object.keys(draft),'expectedVersion'],properties:{...draft,expectedVersion:{type:'integer',minimum:1}}},
  MeetingPublish:{type:'object',required:['requestKey','expectedVersion','reviewFingerprint'],properties:{requestKey:uuid,expectedVersion:{type:'integer',minimum:1},reviewFingerprint:{type:'string',pattern:'^[0-9a-f]{64}$'}}},
  MeetingWriteResult:{type:'object',required:['id'],properties:{id:uuid,alreadyApplied:{type:'boolean'}}},
  MeetingList:{type:'object',required:['items','total','page','pageSize'],properties:{items:{type:'array',items:ref('MeetingSummary')},total:{type:'integer'},page:{type:'integer'},pageSize:{const:20}}},
  MeetingRoster:{type:'object',required:['items','total','page','pageSize'],properties:{items:{type:'array',items:attendee},total:{type:'integer'},page:{type:'integer'},pageSize:{const:20}}},
  MeetingLatest:{type:'object',required:['item'],properties:{item:{anyOf:[ref('MeetingDetail'),{type:'null'}]}}},
  MeetingHistory:{type:'object',required:['items','nextCursor'],properties:{items:{type:'array',items:ref('MeetingSummary')},nextCursor:{type:['string','null']}}},
}
const query = (name:string,schema:object,required=false) => ({name,in:'query',required,schema})
const idParameter = {name:'id',in:'path',required:true,schema:uuid}
const page = query('page',{type:'integer',minimum:1,maximum:999999,default:1})
const search = query('search',{type:'string',maxLength:160})
const operation = (summary:string,result:string,parameters:object[]=[],body?:string,status='200') => ({
  tags:['tenant'],summary,security:[{bearerAuth:[]}],parameters,
  ...(body?{requestBody:{required:true,content:{'application/json':{schema:ref(body)}}}}:{}),
  responses:{[status]:{description:'Authorized meeting minutes result',content:{'application/json':{schema:ref(result)}}},
    '400':{description:'Invalid input'},'401':{description:'Authentication required'},'403':{description:'Role, profile or tenant access denied'},
    '404':{description:'Unknown, cross-tenant or unpublished record'},'409':{description:'Stale review/version or conflicting request key'}},
})
export const meetingMinutesPaths = {
  '/v1/admin/meeting-minutes':{
    get:operation('List meeting drafts and publications','MeetingList',[page,search,query('status',{enum:['All','draft','published'],default:'All'})]),
    post:operation('Create a retry-safe meeting draft','MeetingWriteResult',[],'MeetingDraftCreate','201'),
  },
  '/v1/admin/meeting-minutes/attendees':{get:operation('Find eligible residents by block, flat or name for the meeting date','MeetingRoster',[page,search,query('meetingAt',instant,true)])},
  '/v1/admin/meeting-minutes/{id}':{
    get:operation('Read meeting details and authoritative review fingerprint','AdminMeetingDetail',[idParameter]),
    patch:operation('Replace a draft using its expected version','MeetingWriteResult',[idParameter],'MeetingDraftUpdate'),
  },
  '/v1/admin/meeting-minutes/{id}/publish':{post:operation('Publish once; reviewed content and attendance become immutable','MeetingWriteResult',[idParameter],'MeetingPublish')},
  '/v1/tenant/meeting-minutes/latest':{get:operation('Read the latest published minutes by meeting date','MeetingLatest')},
  '/v1/tenant/meeting-minutes':{get:operation('Fetch 20 older summaries using a stable cursor','MeetingHistory',[query('cursor',{type:'string',maxLength:512}),query('excludeId',uuid)])},
  '/v1/tenant/meeting-minutes/{id}':{get:operation('Read published minutes with attendee display names and flats only','MeetingDetail',[idParameter])},
}
