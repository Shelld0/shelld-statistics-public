/* First launch of the Public Beta. No network calls, no passwords and no cloud account. */
(()=>{
 'use strict';
 const by=id=>document.getElementById(id);
 const KEY='public_welcome_done_v1';
 async function complete(){
   await window.shelld.setSetting(KEY,'1');
   const modal=by('publicWelcomeModal');
   if(modal?.classList.contains('open'))window.closeTopModal?.();
 }
 async function showOnce(){
   try{
     if(await window.shelld.getSetting(KEY)==='1')return;
     if(window.openModal)window.openModal('publicWelcomeModal');
   }catch(error){console.warn('Could not initialize onboarding:',error.message);}
 }
 by('publicWelcomeManual')?.addEventListener('click',async()=>{await complete();});
 by('publicWelcomeMt5')?.addEventListener('click',async()=>{
   await complete();
   if(window.openModal)window.openModal('mt5Modal');
 });
 // Account list loads asynchronously. This modal never requires an online account.
 window.addEventListener('load',()=>setTimeout(showOnce,250),{once:true});
})();
