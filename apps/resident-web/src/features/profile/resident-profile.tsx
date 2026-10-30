'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { getAppConfig, LanguageSwitcher } from '@block9/app-platform'
import { useResidentAuth } from '../../app/auth-provider'
import { LoadState, TenantWorkspacePicker } from '../../lib/auth-ui'
import { useApiPatch } from '../../lib/use-api-mutations'

export type ResidentProfile = {fullName:string;email:string;phone:string|null;unit:string;unitNumber:string;buildingName:string;organizationName:string;apartmentCode:string;timezone:string}
export function ResidentProfileWorkspace({data,loading,error,onRetry,onSaved}:{data:ResidentProfile|null;loading:boolean;error:string|null;onRetry:()=>void;onSaved:()=>void}) {
  const [editing,setEditing]=useState(false),[name,setName]=useState(''),[phone,setPhone]=useState(''),[saving,setSaving]=useState(false),[saveError,setSaveError]=useState(''),[message,setMessage]=useState('')
  const patch=useApiPatch(),{logout,provider}=useResidentAuth(),locked=useRef(false)
  const heading=useRef<globalThis.HTMLHeadingElement>(null),nameInput=useRef<globalThis.HTMLInputElement>(null),errorPanel=useRef<globalThis.HTMLDivElement>(null)
  const original=useRef<{name:string;phone:string}>({name:'',phone:''})
  const dirty=editing&&(name!==original.current.name||phone!==original.current.phone)
  useEffect(()=>{const previous=document.title;document.title=`${editing?'Edit profile':'Profile'} | ${getAppConfig().application.productName}`;if(editing)nameInput.current?.focus();else heading.current?.focus({preventScroll:true});return()=>{document.title=previous}},[editing])
  useEffect(()=>{if(saveError)errorPanel.current?.focus()},[saveError])
  useEffect(()=>{if(!dirty)return;const leave=(event:globalThis.BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''};window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave)},[dirty])
  const edit=()=>{if(!data)return;original.current={name:data.fullName,phone:data.phone??''};setName(data.fullName);setPhone(data.phone??'');setSaveError('');setMessage('');setEditing(true)}
  const cancel=()=>{if(saving)return;if(dirty&&!window.confirm('Discard your unsaved profile changes?'))return;setEditing(false);setSaveError('')}
  const save=async(event:FormEvent<globalThis.HTMLFormElement>)=>{
    event.preventDefault();if(locked.current)return;locked.current=true;setSaving(true);setSaveError('');setMessage('')
    try{await patch<ResidentProfile>('/v1/tenant/profile',{fullName:name,phone:phone.trim()||null});setEditing(false);setMessage('Your profile has been updated.');onSaved()}
    catch(cause){setSaveError(cause instanceof Error?cause.message:'Could not update your profile. Your changes have been kept.')}
    finally{locked.current=false;setSaving(false)}
  }
  return <section className="section-stack resident-profile-workspace" aria-busy={saving}>
    <header className="card-title-row"><div><h1 ref={heading} tabIndex={-1}>{editing?'Edit profile':'Profile'}</h1><p>Your resident account and preferences.</p></div>{!editing&&<button className="secondary" type="button" onClick={onRetry}>Refresh profile</button>}</header>
    {!editing&&<LoadState loading={loading} error={error} onRetry={onRetry}/>}
    {message&&<p role="status" className="payment-feedback success">{message}</p>}
    {saveError&&<div ref={errorPanel} tabIndex={-1} className="inline-error" role="alert">{saveError} Your input has been kept.</div>}
    {editing?<form className="card complaint-form" onSubmit={(event)=>void save(event)}><fieldset className="receipt-fields" disabled={saving}>
      <label>Full name<input ref={nameInput} autoComplete="name" required minLength={2} maxLength={120} value={name} onChange={(event)=>setName(event.target.value)}/></label>
      <label>Phone (optional)<input autoComplete="tel" type="tel" inputMode="tel" maxLength={24} value={phone} onChange={(event)=>setPhone(event.target.value)}/><small>Leave blank to remove your phone number.</small></label>
      <p>Email and flat are read-only. Contact your community administrator for changes to your residence.</p><dl className="resident-profile-details"><div><dt>Email</dt><dd>{data?.email}</dd></div><div><dt>Flat / block</dt><dd>{data?.unit}</dd></div></dl>
      <div className="complaint-actions"><button className="primary" type="submit">{saving?'Saving…':'Save profile'}</button><button className="secondary" type="button" onClick={cancel}>Cancel</button></div>
    </fieldset></form>:<div className="resident-profile-columns">{data&&<article className="card section-stack"><div className="resident-profile-person"><span className="resident-profile-initials" aria-hidden="true">{data.fullName.trim().split(/\s+/).slice(0,2).map((part)=>part[0]).join('').toUpperCase()}</span><div><h2>{data.fullName}</h2><p>Resident · {data.organizationName}</p></div></div><dl className="resident-profile-details"><div><dt>Email</dt><dd>{data.email}</dd></div><div><dt>Phone</dt><dd>{data.phone||'Not provided'}</dd></div><div><dt>Flat</dt><dd>{data.unitNumber}</dd></div><div><dt>Block</dt><dd>{data.buildingName}</dd></div><div><dt>Apartment ID</dt><dd>{data.apartmentCode}</dd></div></dl><button className="secondary" type="button" onClick={edit}>Edit profile</button></article>}
      <section className="card section-stack"><h2>Preferences and access</h2>{provider==='better-auth'&&<Link className="secondary" href="/security/passkeys">Passkeys and sign-in</Link>}<div><h3>Language</h3><LanguageSwitcher/></div><div><h3>Workspace</h3><TenantWorkspacePicker/></div><button className="secondary" type="button" onClick={()=>window.dispatchEvent(new globalThis.Event('myapartment:open-install'))}>Add to Home Screen</button><button className="secondary" type="button" onClick={()=>logout({logoutParams:{returnTo:globalThis.location.origin}})}>Sign out</button></section>
    </div>}
  </section>
}
