'use client';
import { useEffect, useMemo, useState } from 'react';

export type Message = { role:string; content:string };
export type ReviewItem = {
  id:string; prompt:string;primary_intent:string;stage:string;
  left:string;right:string;leftConversation:Message[];rightConversation:Message[];
};
export type VoteChoice = 'left' | 'right' | 'tie' | 'both_bad' | 'skip';

function Context({ messages }:{messages:Message[]}){
  const earlier=useMemo(()=>{
    if(!Array.isArray(messages))return [];
    // Last assistant response is already shown prominently above.
    const copy=[...messages];
    for(let i=copy.length-1;i>=0;i--){
      if(copy[i]?.role==='assistant'){copy.splice(i,1);break;}
    }
    // The last user prompt is in the main prompt panel.
    for(let i=copy.length-1;i>=0;i--){
      if(copy[i]?.role==='user'){copy.splice(i,1);break;}
    }
    return copy.filter(x=>x&&x.content?.trim());
  },[messages]);
  if(!earlier.length)return null;
  return <details className="context-section">
    <summary>Show earlier conversation ({earlier.length} messages)</summary>
    <div className="context-list">{earlier.map((m,i)=><div key={i} className="context-turn">
      <span>{m.role==='user'?'User':m.role==='assistant'?'Assistant':m.role}</span>
      <p>{m.content}</p>
    </div>)}</div>
  </details>;
}
const options:{value:VoteChoice;label:string;hint:string;shortcut:string}[]=[
  {value:'left',label:'Prefer response A',hint:'The answer on the left',shortcut:'1'},
  {value:'right',label:'Prefer response B',hint:'The answer on the right',shortcut:'2'},
  {value:'tie',label:'Tie',hint:'Both are equally preferable',shortcut:'3'},
  {value:'both_bad',label:'Both poor',hint:'Neither is an acceptable answer',shortcut:'4'},
  {value:'skip',label:'Unable to judge',hint:'Abstain; another reviewer will be assigned',shortcut:'5'},
];
export default function ReviewCard({ item, saving, onSubmit }:{item:ReviewItem;saving:boolean;onSubmit:(choice:VoteChoice)=>Promise<void>}){
  const [choice,setChoice]=useState<VoteChoice|null>(null);
  const [showInstructions,setShowInstructions]=useState(false);
  useEffect(()=>setChoice(null),[item.id]);
  useEffect(()=>{
    const handler=(e:KeyboardEvent)=>{
      const target=e.target as HTMLElement|null;
      if(target?.closest('input,textarea,select,button')||e.metaKey||e.altKey||e.ctrlKey)return;
      const match=options.find(o=>o.shortcut===e.key);
      if(match){setChoice(match.value);e.preventDefault();}
    };
    window.addEventListener('keydown',handler);
    return ()=>window.removeEventListener('keydown',handler);
  },[]);
  return <div className="review-layout">
    <section className="prompt-card">
      <div className="section-eyebrow"><span className="little-dot"/> Original user request</div>
      <p className="prompt-text">{item.prompt}</p>
      <div className="prompt-footer"><span className="meta-chip">Observation {item.id}</span></div>
    </section>
    <div className="responses-head">
      <div>
        <div className="section-eyebrow">Side-by-side comparison</div>
        <h2>Which response is better?</h2>
      </div>
      <button type="button" className="text-button" onClick={()=>setShowInstructions(v=>!v)}>
        {showInstructions?'Hide':'View'} judging guidance
      </button>
    </div>
    {showInstructions&&<div className="guidance">
      Vote on which answer better addresses the user’s request. Consider factual reliability, relevance,
      clarity and usefulness. Use <b>Tie</b> when both are equally preferable, <b>Both poor</b> when
      neither is satisfactory, and <b>Unable to judge</b> if you cannot meaningfully evaluate the pair.
      Model identities and other reviewers’ votes are hidden. Do not coordinate with another reviewer before submitting.
    </div>}
    <div className="response-grid">
      <article className="response-card">
        <div className="response-top"><span className="response-letter">A</span><div><strong>Response A</strong><small>Anonymous model</small></div></div>
        <div className="response-text">{item.left}</div>
        <Context messages={item.leftConversation}/>
      </article>
      <article className="response-card">
        <div className="response-top"><span className="response-letter blue">B</span><div><strong>Response B</strong><small>Anonymous model</small></div></div>
        <div className="response-text">{item.right}</div>
        <Context messages={item.rightConversation}/>
      </article>
    </div>
    <section className="vote-card">
      <div className="vote-heading"><div><div className="section-eyebrow">Your independent vote</div><h3>Select your preference</h3></div><span className="shortcuts-hint">Keys 1–5</span></div>
      <div className="vote-options" role="radiogroup" aria-label="Which answer is better?">
        {options.map(o=><button key={o.value} type="button" className={`vote-option ${choice===o.value?'selected':''}`} role="radio"
          aria-checked={choice===o.value} disabled={saving} onClick={()=>setChoice(o.value)}>
          <span className="radio-circle"><span/></span><span className="option-copy"><strong>{o.label}</strong><small>{o.hint}</small></span>
          <span className="vote-key">{o.shortcut}</span>
        </button>)}
      </div>
      <div className="vote-bottom">
        <span className="small-muted">Your choice is saved immediately and cannot be changed afterward.</span>
        <button type="button" disabled={!choice||saving} className="primary-button" onClick={()=>{if(choice)void onSubmit(choice);}}>
          {saving?'Saving…':'Submit & next →'}
        </button>
      </div>
    </section>
  </div>;
}
