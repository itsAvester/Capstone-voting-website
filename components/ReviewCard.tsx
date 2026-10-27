'use client';
import { useEffect, useMemo, useState } from 'react';

export type Message = { role:string; content:string };
export type ReviewItem = {
  id:string; prompt:string;primary_intent:string;stage:string;
  left:string;right:string;leftConversation:Message[];rightConversation:Message[];
};
export type VoteChoice = 'left' | 'right' | 'tie' | 'both_bad' | 'skip';
export type ReasonTarget = 'left' | 'right' | 'both';
export type ReasonTag = { code:string; appliesTo:ReasonTarget };
export type VoteSubmission = { choice:VoteChoice; reasonTags:ReasonTag[]; reasonKeywords:string; reasonKeywordsTarget:ReasonTarget };

const options:{value:VoteChoice;label:string;key:string}[]=[
  {value:'left',label:'Response A',key:'1'},
  {value:'right',label:'Response B',key:'2'},
  {value:'tie',label:'Tie',key:'3'},
  {value:'both_bad',label:'Both poor',key:'4'},
  {value:'skip',label:'Skip',key:'5'},
];
export const REASON_OPTIONS=[
  {code:'refused_punted',label:'Refused / punted'},
  {code:'no_citations',label:'No citations'},
  {code:'broken_citations',label:'Broken citations'},
  {code:'unsupported_claim',label:'Unsupported claim'},
  {code:'factual_error',label:'Factual error'},
  {code:'incomplete',label:'Incomplete'},
  {code:'off_topic',label:'Off-topic'},
  {code:'too_vague',label:'Too vague'},
  {code:'too_verbose',label:'Too verbose'},
  {code:'poor_formatting',label:'Poor formatting'},
  {code:'better_sourcing',label:'Better sourcing'},
  {code:'more_useful',label:'More useful'},
  {code:'missing_context',label:'Missing context'},
] as const;

function Context({ messages }:{messages:Message[]}){
  const earlier=useMemo(()=>{
    if(!Array.isArray(messages))return [];
    const copy=[...messages];
    for(let i=copy.length-1;i>=0;i--){if(copy[i]?.role==='assistant'){copy.splice(i,1);break;}}
    for(let i=copy.length-1;i>=0;i--){if(copy[i]?.role==='user'){copy.splice(i,1);break;}}
    return copy.filter(x=>x&&x.content?.trim());
  },[messages]);
  if(!earlier.length)return null;
  return <details className="context-section">
    <summary>Earlier conversation ({earlier.length})</summary>
    <div className="context-list">{earlier.map((m,i)=><div key={i} className="context-turn">
      <span>{m.role==='user'?'User':m.role==='assistant'?'Assistant':m.role}</span><p>{m.content}</p>
    </div>)}</div>
  </details>;
}

export default function ReviewCard({item,saving,onSubmit}:{item:ReviewItem;saving:boolean;onSubmit:(vote:VoteSubmission)=>Promise<void>}){
  const [choice,setChoice]=useState<VoteChoice|null>(null);
  const [reasonTarget,setReasonTarget]=useState<ReasonTarget>('both');
  const [reasonTags,setReasonTags]=useState<ReasonTag[]>([]);
  const [reasonKeywords,setReasonKeywords]=useState('');
  const [showInstructions,setShowInstructions]=useState(false);
  useEffect(()=>{setChoice(null);setReasonTarget('both');setReasonTags([]);setReasonKeywords('');setShowInstructions(false);},[item.id,item.stage]);
  useEffect(()=>{
    const handler=(e:KeyboardEvent)=>{
      const target=e.target as HTMLElement|null;
      if(target?.closest('input,textarea,select,button,[contenteditable]')||e.metaKey||e.altKey||e.ctrlKey)return;
      const match=options.find(o=>o.key===e.key);
      if(match){selectVote(match.value);e.preventDefault();}
    };
    window.addEventListener('keydown',handler);
    return ()=>window.removeEventListener('keydown',handler);
  },[]);
  function selectVote(value:VoteChoice){
    setChoice(value);
    // Default reason target is the losing side, but reviewers can freely override it.
    setReasonTarget(value==='left'?'right':value==='right'?'left':'both');
  }
  function toggleTag(code:string){
    setReasonTags(previous=>{
      const exists=previous.some(t=>t.code===code&&t.appliesTo===reasonTarget);
      if(exists)return previous.filter(t=>!(t.code===code&&t.appliesTo===reasonTarget));
      if(previous.length>=8)return previous;
      return [...previous,{code,appliesTo:reasonTarget}];
    });
  }
  return <div className="review-layout">
    <section className="prompt-card" aria-labelledby="prompt-title">
      <div className="prompt-heading"><strong id="prompt-title">User prompt</strong><span className="meta-chip">{item.id}</span></div>
      <p className="prompt-text">{item.prompt}</p>
    </section>

    <div className="response-grid" aria-label="Blind comparison of two model responses">
      <article className="response-card">
        <div className="response-top"><span className="response-letter">A</span><strong>Response A</strong></div>
        <div className="response-scroll"><div className="response-text">{item.left}</div><Context messages={item.leftConversation}/></div>
      </article>
      <article className="response-card">
        <div className="response-top"><span className="response-letter blue">B</span><strong>Response B</strong></div>
        <div className="response-scroll"><div className="response-text">{item.right}</div><Context messages={item.rightConversation}/></div>
      </article>
    </div>

    <section className="vote-card" aria-label="Vote and reasons">
      <div className="vote-line">
        <strong className="field-name">Your vote <span className="small-muted">(keys 1–5)</span></strong>
        <div className="vote-options" role="radiogroup" aria-label="Which answer do you prefer?">
          {options.map(o=><button key={o.value} type="button"
            className={`vote-option ${choice===o.value?'selected':''}`}
            role="radio" aria-checked={choice===o.value} disabled={saving} onClick={()=>selectVote(o.value)}>
            <span>{o.label}</span><kbd>{o.key}</kbd>
          </button>)}
        </div>
      </div>
      <div className="reasons-line">
        <div className="reason-label"><strong className="field-name">Reason tags <span className="small-muted">optional</span></strong>
          <label className="reason-target-label">Applies to
            <select aria-label="Which response do these tags apply to?" value={reasonTarget} onChange={e=>setReasonTarget(e.target.value as ReasonTarget)} disabled={saving}>
              <option value="left">A</option><option value="right">B</option><option value="both">Both</option>
            </select>
          </label>
        </div>
        <div className="reason-tags" aria-label="Suggested reasons">
          {REASON_OPTIONS.map(t=><button key={t.code} type="button" className={`tag-button ${reasonTags.some(x=>x.code===t.code&&x.appliesTo===reasonTarget)?'active':''}`}
            aria-pressed={reasonTags.some(x=>x.code===t.code&&x.appliesTo===reasonTarget)}
            disabled={saving||reasonTags.length>=8&&!reasonTags.some(x=>x.code===t.code&&x.appliesTo===reasonTarget)}
            onClick={()=>toggleTag(t.code)}>{t.label}</button>)}
        </div>
      </div>
      <div className="reason-entry-line">
        <label htmlFor="reason-keywords" className="field-name">Other keywords <span className="small-muted">optional</span></label>
        <input id="reason-keywords" type="text" maxLength={160} value={reasonKeywords} disabled={saving}
          onChange={e=>setReasonKeywords(e.target.value)} placeholder="e.g. outdated source, skipped calculation"/>
        <button type="button" className="primary-button vote-submit" disabled={!choice||saving}
          onClick={()=>{if(choice)void onSubmit({choice,reasonTags,reasonKeywords:reasonKeywords.trim(),reasonKeywordsTarget:reasonTarget});}}>
          {saving?'Saving…':'Submit & next →'}
        </button>
      </div>
      {reasonTags.length>0&&<p className="tag-selection" aria-live="polite">Selected: {reasonTags.map(x=>`${x.code.replaceAll('_',' ')} (${x.appliesTo==='left'?'A':x.appliesTo==='right'?'B':'both'})`).join(' · ')}</p>}
      <div className="guidance-toggle"><button type="button" className="text-button" onClick={()=>setShowInstructions(v=>!v)}>{showInstructions?'Hide guidance':'Judging guidance'}</button></div>
      {showInstructions&&<p className="guidance">Choose the more useful and reliable answer to the actual user request. Tie = equally preferred; Both poor = neither adequate; Skip = cannot assess. Tags describe what you observed, not automatic rules: some requests do not need citations. A/B refers to the displayed panels; model names stay hidden. Reasons are optional and saved with your vote.</p>}
    </section>
  </div>;
}
