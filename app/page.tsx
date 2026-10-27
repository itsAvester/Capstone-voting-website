'use client';
import { useCallback, useEffect, useState } from 'react';
import ReviewCard,{type ReviewItem,type VoteSubmission} from '@/components/ReviewCard';

type Reviewer={id:string;display_name:string};
type Stats={assigned:number;completed:number;closed:number;target:number};
type Payload={reviewer:Reviewer;item:ReviewItem|null;stats:Stats};
async function api<T>(url:string,options?:RequestInit):Promise<T>{
  const res=await fetch(url,{...options,cache:'no-store'});
  const data=await res.json().catch(()=>({error:`Request failed (${res.status})`}));
  if(!res.ok)throw new Error(data.error||'Unexpected server error.');
  return data as T;
}
export default function Home(){
  const [reviewers,setReviewers]=useState<Reviewer[]>([]);
  const [reviewerId,setReviewerId]=useState('reviewer_1');
  const [pin,setPin]=useState('');
  const [view,setView]=useState<'loading'|'login'|'review'>('loading');
  const [session,setSession]=useState<Payload|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [exportOpen,setExportOpen]=useState(false);
  const [adminPin,setAdminPin]=useState('');
  const [exportBusy,setExportBusy]=useState(false);

  const load=useCallback(async()=>{
    try{
      const next=await api<Payload>('/api/next');
      setSession(next);setView('review');setError('');
    }catch(e){
      if(e instanceof Error && e.message==='Please sign in.'){
        setSession(null);setView('login');return;
      }
      setError(e instanceof Error?e.message:'Could not load your items.');
      setView('login');
    }
  },[]);
  useEffect(()=>{
    void Promise.allSettled([
      api<{reviewers:Reviewer[]}>('/api/reviewers').then(d=>setReviewers(d.reviewers)),
      load()
    ]).then(()=>setView(v=>v==='loading'?'login':v));
  },[load]);

  async function login(e:React.FormEvent){
    e.preventDefault();setBusy(true);setError('');
    try{
      await api('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reviewerId,pin})});
      setPin('');await load();
    }catch(e){setError(e instanceof Error?e.message:'Could not sign in.');}
    finally{setBusy(false);}
  }
  async function logout(){
    setBusy(true);
    try{await api('/api/logout',{method:'POST'});}finally{
      setSession(null);setPin('');setAdminPin('');setView('login');setBusy(false);
    }
  }
  async function submit(vote:VoteSubmission){
    if(!session?.item)return;
    setBusy(true);setError('');
    try{
      await api('/api/vote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({observationId:session.item.id,...vote})});
      await load();
    }catch(e){setError(e instanceof Error?e.message:'Could not save your vote.');}
    finally{setBusy(false);}
  }
  async function downloadExport(type:'summary'|'votes'){
    setExportBusy(true);setError('');
    try{
      const res=await fetch('/api/admin/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,pin:adminPin})});
      if(!res.ok){const obj=await res.json();throw new Error(obj.error||'Export failed.');}
      const blob=await res.blob();const url=URL.createObjectURL(blob);
      const a=document.createElement('a');a.href=url;
      a.download=type==='summary'?'search_arena_consensus.csv':'search_arena_individual_votes.csv';
      document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
    }catch(e){setError(e instanceof Error?e.message:'Export failed.');}
    finally{setExportBusy(false);}
  }
  const reviewerName=session?.reviewer?.display_name||'Reviewer';
  const stats=session?.stats;
  const pct=stats?.assigned?Math.round(stats.completed/stats.assigned*100):0;
  return <div className={`app-shell ${view==='review' ? 'review-shell' : ''}`}>
    <header className="site-header">
      <div className={`header-content ${view==='review' ? '' : 'login-header'}`}>
        {view==='review' && <div className="brand"><div className="brand-symbol">≋</div><div><strong>Search Arena</strong><small>HUMAN PREFERENCE STUDY</small></div></div>}
        <div className="header-right"><span className="batch-label"><span className="batch-dot"/> Batch 01 · 500 observations</span>
          {view==='review'&&<button type="button" className="header-user" onClick={()=>void logout()} title="Sign out">
            <span className="avatar">{reviewerName.slice(0,1).toUpperCase()}</span>{reviewerName}<span className="signout">Sign out</span>
          </button>}
        </div>
      </div>
    </header>
    {view==='loading'?<main className="centered"><div className="spinner"/><p>Loading your review workspace…</p></main>:
     view==='login'?<main className="login-wrap"><form className="login-card" onSubmit={e=>void login(e)}>
         <div className="eyebrow">REVIEWER SIGN IN</div><h2>Welcome back</h2><p>Choose your reviewer profile and enter your personal PIN to continue.</p>
         <label htmlFor="reviewer">Reviewer</label><select id="reviewer" value={reviewerId} onChange={e=>setReviewerId(e.target.value)}>
         {(reviewers.length?reviewers:Array.from({length:5},(_,i)=>({id:`reviewer_${i+1}`,display_name:`Reviewer ${i+1}`}))).map(r=><option key={r.id} value={r.id}>{r.display_name}</option>)}
         </select>
         <label htmlFor="pin">Personal PIN</label><input type="password" id="pin" inputMode="numeric" autoComplete="off" pattern="[0-9]{4}" minLength={4} maxLength={4} value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,'').slice(0,4))} placeholder="Enter your 4-digit PIN" required/>
         {error&&<p className="error-box" role="alert">{error}</p>}
         <button className="primary-button full" disabled={busy||!/^\d{4}$/.test(pin)}>{busy?'Signing in…':'Start reviewing →'}</button>
         <p className="login-help">Your progress is saved automatically. Model identities and other reviewers’ votes stay hidden.</p>
         
       </form></main>:
       <main className="workspace review-workspace">
         <section className="review-toolbar" aria-label="Review progress">
           <div className="review-toolbar-title"><strong>Compare responses</strong><span>Blind review · {session?.item?.id||'No current observation'}</span></div>
           <div className="progress-card"><div className="progress-label"><span>Your progress</span><b>{stats?.completed||0} / {stats?.assigned||0}</b></div>
             <div className="progress-track"><div style={{width:`${pct}%`}}/></div></div>
         </section>
         {error&&<p className="error-box" role="alert">{error} <button type="button" onClick={()=>void load()}>Refresh</button></p>}
         {session?.item?<ReviewCard key={`${session.item.id}-${session.item.stage}`} item={session.item} saving={busy} onSubmit={submit}/>:
           <div className="empty-card"><div className="empty-icon">✓</div><h2>You're all caught up.</h2><p>No pending assignments right now. If other reviewers disagree, you may receive an additional comparison later.</p>
             <button type="button" className="secondary-button" onClick={()=>void load()}>Check for new assignments</button></div>}
         <section className="workspace-footer"><span>{stats?.closed||0} / 500 observations resolved or flagged</span>
           <button type="button" className="text-button" onClick={()=>setExportOpen(v=>!v)}>{exportOpen?'Close export':'Admin export'}</button></section>
         {exportOpen&&<section className="export-card"><h3>Export annotation data</h3><p>For the project coordinator. Download a consensus summary keyed by source row, or a vote-level audit trail. Never share the admin export password publicly.</p>
           <label htmlFor="admin-pin">Admin export password</label><input id="admin-pin" type="password" value={adminPin} onChange={e=>setAdminPin(e.target.value)} placeholder="Administrator password"/>
           <div className="export-actions"><button className="secondary-button" disabled={!adminPin||exportBusy} onClick={()=>void downloadExport('summary')}>Download consensus CSV</button>
             <button className="secondary-button" disabled={!adminPin||exportBusy} onClick={()=>void downloadExport('votes')}>Download individual votes CSV</button></div>
         </section>}
       </main>}
    {view!=='review'&&<footer className="site-footer"><div>SEARCH ARENA / HUMAN ANNOTATION</div><span>Blind review · Independent judgment · Research use</span></footer>}
  </div>;
}
