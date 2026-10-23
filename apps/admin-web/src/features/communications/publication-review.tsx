'use client'
import { useEffect, useRef, type ReactNode } from 'react'
import { getAppConfig } from '@nivasa/app-platform'
export function PublicationReview({title,timeZone,startsAt,endsAt,busy,error,children,onConfirm,onBack}:{title:string;timeZone:string;startsAt:string;endsAt:string;busy:boolean;error:string|null;children:ReactNode;onConfirm:()=>void;onBack:()=>void}){
  const heading=useRef<globalThis.HTMLHeadingElement>(null),errorPanel=useRef<globalThis.HTMLParagraphElement>(null)
  const format=(value:string)=>new Date(value).toLocaleString('en-IN',{timeZone,dateStyle:'full',timeStyle:'short'})
  useEffect(()=>{const previous=document.title;document.title=`${title} | ${getAppConfig().application.productName}`;heading.current?.focus();return()=>{document.title=previous}},[title])
  useEffect(()=>{if(error)errorPanel.current?.focus()},[error])
  return <section className="card section-stack" aria-busy={busy}><h1 ref={heading} tabIndex={-1}>{title}</h1>{children}<dl className="account-detail"><div><dt>Community timezone</dt><dd>{timeZone}</dd></div><div><dt>Starts</dt><dd>{format(startsAt)}</dd></div><div><dt>Ends</dt><dd>{format(endsAt)}</dd></div></dl><p>Confirm to publish these details. Scheduled items appear in resident Updates; voting and announcement banners follow their scheduled times.</p>{error&&<p ref={errorPanel} tabIndex={-1} className="inline-error" role="alert">{error} Your reviewed details and request ID have been kept. Retrying this publication uses the same ID.</p>}<div className="complaint-actions"><button className="primary" type="button" disabled={busy} onClick={onConfirm}>{busy?'Publishing…':'Confirm publication'}</button><button className="secondary" type="button" disabled={busy} onClick={onBack}>Back to edit</button></div></section>
}
