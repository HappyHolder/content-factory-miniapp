import { useCallback, useEffect, useRef, useState } from 'react'
import { FileText, Loader2, Paperclip, Trash2 } from 'lucide-react'
import { API_BASE } from '@/lib/api'
import { moderatorFetch } from '@/lib/telegram'

type TargetType='COMMUNITY_MANAGER'|'MODERATOR'|'PERSONA'
type Doc={id:string;name:string;mime:string;sizeBytes:number;createdAt:string}
const accept='.pdf,.docx,.md,.markdown,.txt'
const size=(n:number)=>n>=1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB'

export function RoleKnowledgeDocs({targetType,targetId,title='Files',description}:{targetType:TargetType;targetId:string;title?:string;description:string}){
 const [docs,setDocs]=useState<Doc[]>([]),[busy,setBusy]=useState(''),[error,setError]=useState('');const input=useRef<HTMLInputElement>(null)
 const api=useCallback(async(path:string,body:FormData|Record<string,unknown>)=>{const options:RequestInit={method:'POST',body:body instanceof FormData?body:JSON.stringify(body),...(body instanceof FormData?{}:{headers:{'Content-Type':'application/json'}})};const r=await moderatorFetch(API_BASE+'/api/role-knowledge-docs/'+path,options),d=await r.json();if(!r.ok)throw Error(d.error||'Could not process the file');return d},[])
 const load=useCallback(async()=>{try{const d=await api('list',{targetType,targetId});setDocs(d.docs||[])}catch(e){setError(e instanceof Error?e.message:'Could not load files')}},[api,targetId,targetType])
 useEffect(()=>{void load()},[load])
 const upload=async(file:File)=>{setBusy('upload');setError('');try{const form=new FormData();form.append('targetType',targetType);form.append('targetId',targetId);form.append('file',file);const d=await api('upload',form);setDocs(v=>[d.doc,...v])}catch(e){setError(e instanceof Error?e.message:'Could not upload file')}finally{setBusy('')}}
 const remove=async(id:string)=>{setBusy(id);setError('');try{await api('delete',{targetType,targetId,docId:id});setDocs(v=>v.filter(x=>x.id!==id))}catch(e){setError(e instanceof Error?e.message:'Could not delete file')}finally{setBusy('')}}
 return <div className="rounded-[12px] border border-white/[.07] bg-white/[.02] p-3">
  <div className="flex items-start gap-2.5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-[rgba(255,106,0,.1)] text-[#FF6A00]"><Paperclip size={16}/></span><span><p className="text-[12px] font-semibold text-white">{title}</p><p className="mt-0.5 text-[10px] leading-relaxed text-[#777780]">{description}</p></span></div>
  {docs.length>0&&<div className="mt-3 space-y-1.5">{docs.map(doc=><div key={doc.id} className="flex min-h-11 items-center gap-2 rounded-[10px] border border-white/[.06] bg-white/[.03] px-2.5"><FileText size={14} className="shrink-0 text-[#FF6A00]"/><span className="min-w-0 flex-1"><span className="block truncate text-[11px] text-white">{doc.name}</span><span className="text-[9px] text-[#66666E]">{size(doc.sizeBytes)}</span></span><button type="button" aria-label={'\u0423\u0434\u0430\u043b\u0438\u0442\u044c '+doc.name} disabled={!!busy} onClick={()=>void remove(doc.id)} className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-[9px] text-[#777780] hover:bg-red-400/10 hover:text-red-300 focus-visible:ring-2 focus-visible:ring-[#FF6A00] disabled:opacity-40">{busy===doc.id?<Loader2 size={14} className="animate-spin"/>:<Trash2 size={14}/>}</button></div>)}</div>}
  <input ref={input} type="file" accept={accept} className="sr-only" onChange={e=>{const f=e.target.files?.[0];e.currentTarget.value='';if(f)void upload(f)}}/>
  <button type="button" disabled={!!busy} onClick={()=>input.current?.click()} className="mt-3 flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-[11px] border border-dashed border-white/[.12] text-[11px] font-semibold text-[#A1A1AA] transition-colors hover:border-[rgba(255,106,0,.35)] hover:bg-[rgba(255,106,0,.05)] focus-visible:ring-2 focus-visible:ring-[#FF6A00] disabled:cursor-wait disabled:opacity-50">{busy==='upload'?<Loader2 size={15} className="animate-spin"/>:<Paperclip size={15}/>} {busy==='upload'?'\u0418\u0437\u0432\u043b\u0435\u043a\u0430\u044e \u0442\u0435\u043a\u0441\u0442\u2026':'\u041f\u0440\u0438\u043a\u0440\u0435\u043f\u0438\u0442\u044c PDF, DOCX, MD \u0438\u043b\u0438 TXT'}</button>
  {error&&<p role="alert" className="mt-2 text-[10px] text-red-300">{error}</p>}
 </div>
}
