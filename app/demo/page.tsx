'use client';
import Link from 'next/link';
import { useState } from 'react';
import ReviewCard,{type ReviewItem,type VoteChoice} from '@/components/ReviewCard';
const sample:ReviewItem={
  id:'DEMO-001',prompt:'Explain two advantages and two limitations of solar power for a small Colorado community.',
  primary_intent:'Explanation',stage:'initial',
  left:'Solar power can reduce utility costs and provide distributed generation directly on rooftops. Two important limitations are that electricity output varies with daylight and weather, and that upfront system costs may be significant. Battery storage or grid connections can help address intermittent generation.',
  right:'Solar is a fantastic energy source because it is completely clean and available all the time. It has no disadvantages except the price, and it should be the first choice for every community.',
  leftConversation:[{role:'user',content:'Explain two advantages and two limitations of solar power for a small Colorado community.'},{role:'assistant',content:'...'}],
  rightConversation:[{role:'user',content:'Explain two advantages and two limitations of solar power for a small Colorado community.'},{role:'assistant',content:'...'}]
};
export default function Demo(){
  const [vote,setVote]=useState<VoteChoice|null>(null);
  return <div className="app-shell"><header className="site-header"><div className="header-content"><Link href="/" className="brand"><div className="brand-symbol">≋</div><div><strong>Search Arena</strong><small>INTERFACE PREVIEW</small></div></Link><span className="meta-chip">DEMO ONLY · NO SAVED VOTES</span></div></header>
    <main className="workspace"><section className="workspace-header"><div><div className="eyebrow">LOCAL DESIGN PREVIEW</div><h1>Compare & decide<span className="period">.</span></h1><p>Try the interface. This sample does not come from your exported dataset.</p></div></section>
      {vote?<section className="empty-card"><div className="empty-icon">✓</div><h2>Preview vote recorded locally</h2><p>You selected: <strong>{vote}</strong>. Nothing was written to Supabase.</p><button className="secondary-button" onClick={()=>setVote(null)}>Try another vote</button><Link href="/" className="demo-link">Back to reviewer sign in</Link></section>:
       <ReviewCard item={sample} saving={false} onSubmit={async(choice)=>setVote(choice)}/>}</main>
    <footer className="site-footer"><div>SEARCH ARENA / DEMO</div><span>Practice votes are not saved.</span></footer></div>;
}
