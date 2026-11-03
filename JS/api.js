import {SUPABASE_URL,SUPABASE_ANON_KEY} from './config.js';
import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
export const db=createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
export const el=id=>document.getElementById(id);
export const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const message=(s,error=false)=>{const n=el('message');if(n){n.textContent=s;n.className=error?'message error':'message';}};
export async function guard(admin=false){const {data:{user}}=await db.auth.getUser();if(!user){location.href='index.html';return null;}const {data,error}=await db.from('profiles').select('role,display_name').eq('user_id',user.id).single();if(error||!data||(admin&&data.role!=='admin')){await db.auth.signOut();location.href='index.html';return null;}return {user,profile:data};}
export function wireLogout(){el('logout')?.addEventListener('click',async()=>{await db.auth.signOut();location.href='index.html';});}
export async function rows(table,query){const {data,error}=await query;if(error)throw error;return data||[];}
