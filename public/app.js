const $=id=>document.getElementById(id)
let pairId='',session='',revealed=false,timer=null
function setStatus(text,type=''){const box=$('status');box.className=`status ${type}`;box.querySelector('b').textContent=text}
async function copy(value,button,normal){if(!value)return;await navigator.clipboard.writeText(value);button.textContent='Copied ✓';setTimeout(()=>button.textContent=normal,1800)}
$('generate').onclick=async()=>{
 const number=$('number').value.replace(/\D/g,'')
 if(number.length<7||number.length>15){alert('Enter a valid WhatsApp number');return}
 clearInterval(timer);$('generate').disabled=true;$('pairBox').classList.add('hidden');$('sessionBox').classList.add('hidden');setStatus('Starting pairing...')
 try{
  const response=await fetch('/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({number})})
  const data=await response.json()
  if(!response.ok||!data.success)throw new Error(data.error||'Pairing failed')
  pairId=data.id
  if(data.code){$('code').textContent=data.code;$('pairBox').classList.remove('hidden')}
  setStatus('Waiting for pairing...');timer=setInterval(checkStatus,2000)
 }catch(error){setStatus(error.message||'Pairing failed','error');$('generate').disabled=false}
}
async function checkStatus(){
 if(!pairId)return
 try{
  const response=await fetch(`/api/status/${pairId}`,{cache:'no-store'})
  const data=await response.json()
  if(!data.success)return
  if(data.code){$('code').textContent=data.code;$('pairBox').classList.remove('hidden')}
  if(data.status==='connecting')setStatus('Connecting to WhatsApp...')
  if(data.status==='waiting')setStatus('Waiting for pairing...')
  if(data.status==='connected')setStatus('WhatsApp connected','ok')
  if(data.status==='ready'){
   setStatus('Session generated','ok');session=data.session||'';$('session').textContent='RAZA~••••••••••••••••••••';$('sessionBox').classList.remove('hidden');if(data.sent)$('sent').classList.remove('hidden');clearInterval(timer);$('generate').disabled=false
  }
  if(data.status==='error'){setStatus(data.error||'Pairing failed','error');clearInterval(timer);$('generate').disabled=false}
 }catch{}
}
$('show').onclick=()=>{revealed=!revealed;$('session').textContent=revealed?session:'RAZA~••••••••••••••••••••';$('show').textContent=revealed?'Hide Session':'Show Session';$('copySession').classList.toggle('hidden',!revealed)}
$('copyCode').onclick=()=>copy($('code').textContent,$('copyCode'),'Copy Pair Code')
$('copySession').onclick=()=>copy(session,$('copySession'),'Copy Session')
