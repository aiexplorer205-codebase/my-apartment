#!/usr/bin/env node
// Deployment-only. Runtime credentials should NOT have bucket-admin permissions.
import { createRequire } from 'node:module'
import { photoStoragePolicy, mergePhotoStoragePolicy } from './photo-storage-policy.mjs'
const require=createRequire(new URL('../infrastructure/adapters/package.json',import.meta.url))
const {S3Client,GetBucketLifecycleConfigurationCommand,PutBucketLifecycleConfigurationCommand,GetBucketCorsCommand,PutBucketCorsCommand,GetBucketVersioningCommand,PutPublicAccessBlockCommand}=require('@aws-sdk/client-s3')
const bucket=process.env.S3_BUCKET,region=process.env.S3_REGION,endpoint=process.env.S3_ENDPOINT,provider=process.env.S3_PROVIDER??'s3'
const policy=photoStoragePolicy((process.env.S3_ALLOWED_ORIGINS??'').split(',').map(value=>value.trim()).filter(Boolean))
if(!bucket||!region)throw new Error('Set S3_BUCKET and S3_REGION')
const key=process.env.S3_ADMIN_ACCESS_KEY_ID,secret=process.env.S3_ADMIN_SECRET_ACCESS_KEY
if(Boolean(key)!==Boolean(secret))throw new Error('Both administrative S3 keys are required')
const client=new S3Client({region,endpoint,forcePathStyle:process.env.S3_FORCE_PATH_STYLE==='true',requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED',...(key&&secret?{credentials:{accessKeyId:key,secretAccessKey:secret}}:{})})
try{
  // Print-only is safe and permits review before changing bucket behavior.
  if(!process.argv.includes('--apply')&&!process.argv.includes('--check')){
    console.log(JSON.stringify(policy,null,2))
  }else{
    const safeGet=async(command)=>{try{return await client.send(command)}catch(error){if(['NoSuchLifecycleConfiguration','NoSuchCORSConfiguration'].includes(error.name))return{};throw error}}
    const existing=await safeGet(new GetBucketLifecycleConfigurationCommand({Bucket:bucket}))
    const cors=await safeGet(new GetBucketCorsCommand({Bucket:bucket}))
    const merged=mergePhotoStoragePolicy(existing,cors,policy)
    if(provider!=='r2'){
      const versioning=await client.send(new GetBucketVersioningCommand({Bucket:bucket}))
      if(versioning.Status)throw new Error('Use a dedicated non-versioned media bucket; versioned retention needs separate policy review')
    }
    if(process.argv.includes('--apply')){
      await client.send(new PutBucketLifecycleConfigurationCommand({Bucket:bucket,LifecycleConfiguration:merged.lifecycle}))
      await client.send(new PutBucketCorsCommand({Bucket:bucket,CORSConfiguration:merged.cors}))
      if(provider==='s3')await client.send(new PutPublicAccessBlockCommand({Bucket:bucket,PublicAccessBlockConfiguration:{BlockPublicAcls:true,IgnorePublicAcls:true,BlockPublicPolicy:true,RestrictPublicBuckets:true}}))
      console.log('Media bucket policy applied; verify public access is disabled in the provider console')
    }else{
      for(const rule of policy.lifecycle.Rules){
        const actual=existing.Rules?.find(candidate=>candidate.ID===rule.ID)
        if(!actual||actual.Status!=='Enabled'||actual.Filter?.Prefix!==rule.Filter.Prefix||actual.Expiration?.Days!==rule.Expiration.Days||(rule.AbortIncompleteMultipartUpload&&actual.AbortIncompleteMultipartUpload?.DaysAfterInitiation!==1))throw new Error('Media lifecycle policy does not match')
      }
      const actual=cors.CORSRules?.find(rule=>rule.ID==='myapartment-private-images')
      if(!actual||JSON.stringify([...actual.AllowedOrigins].sort())!==JSON.stringify([...policy.cors.CORSRules[0].AllowedOrigins].sort())||JSON.stringify([...(actual.AllowedMethods??[])].sort())!==JSON.stringify(['GET','HEAD','PUT'])||JSON.stringify((actual.AllowedHeaders??[]).map(header=>header.toLowerCase()).sort())!==JSON.stringify(['content-type','x-amz-meta-sha256']))throw new Error('Media CORS policy does not match')
      console.log('Media lifecycle and CORS policy verified; public access requires a separate provider check')
    }
  }
}catch{console.error('Media bucket configuration failed. Check administrative permissions and provider settings.');process.exitCode=1}
finally{client.destroy()}
