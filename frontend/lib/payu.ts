/** Submits the backend-provided PayU form. The frontend never builds hashes or holds secrets. */
export function submitPayuRedirect(r:{url:string;fields:Record<string,string>}){
  if(r.url.startsWith('/')){window.location.href=r.url;return;} // same-origin (mock mode only)
  const f=document.createElement('form');f.method='POST';f.action=r.url;
  Object.entries(r.fields).forEach(([k,v])=>{const i=document.createElement('input');i.type='hidden';i.name=k;i.value=v;f.appendChild(i);});
  document.body.appendChild(f);f.submit();
}
