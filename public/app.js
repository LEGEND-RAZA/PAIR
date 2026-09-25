const $ = (id) => document.getElementById(id)

let pairId = ''
let session = ''
let revealed = false
let timer = null

const MASKED_SESSION = 'RAZA~••••••••••••••••••••'

function setStatus(text, type = '') {
  const box = $('status')
  if (!box) return
  box.className = `status ${type}`
  const boldTag = box.querySelector('b')
  if (boldTag) boldTag.textContent = text
  else box.textContent = text
}

async function copyToClipboard(value, buttonEl, defaultLabel) {
  if (!value) return
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(value)
    } else {
      // Fallback for non-HTTPS or legacy browsers
      const textarea = document.createElement('textarea')
      textarea.value = value
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }

    buttonEl.textContent = 'Copied ✓'
    setTimeout(() => {
      buttonEl.textContent = defaultLabel
    }, 1800)
  } catch (error) {
    alert('Failed to copy to clipboard')
  }
}

function resetState() {
  if (timer) clearInterval(timer)
  timer = null
  pairId = ''
  session = ''
  revealed = false

  $('generate').disabled = true
  $('pairBox').classList.add('hidden')$('sessionBox').classList.add('hidden')
  
  const sentTag = $('sent')
  if (sentTag) sentTag.classList.add('hidden')

  $('show').textContent = 'Show Session'
  $('session').textContent = MASKED_SESSION$('copySession').classList.add('hidden')
}

$('generate').onclick = async () => {
  const rawInput = $('number').value || ''
  const number = rawInput.replace(/\D/g, '')

  if (number.length < 7 || number.length > 15) {
    alert('Enter a valid WhatsApp number with country code')
    return
  }

  resetState()
  setStatus('Starting pairing...')

  try {
    const response = await fetch('/api/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number })
    })

    const data = await response.json()

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Pairing request failed')
    }

    pairId = data.id

    if (data.code) {
      $('code').textContent = data.code
      $('pairBox').classList.remove('hidden')
    }

    setStatus('Waiting for pairing...')
    timer = setInterval(checkStatus, 2000)
  } catch (error) {
    setStatus(error.message || 'Pairing failed', 'error')
    $('generate').disabled = false
  }
}

async function checkStatus() {
  if (!pairId) return

  try {
    const response = await fetch(`/api/status/${pairId}`, { cache: 'no-store' })
    const data = await response.json()

    if (!data.success) return

    if (data.code) {
      $('code').textContent = data.code
      $('pairBox').classList.remove('hidden')
    }

    if (data.status === 'connecting') {
      setStatus('Connecting to WhatsApp...')
    } else if (data.status === 'waiting') {
      setStatus('Waiting for pairing...')
    } else if (data.status === 'connected') {
      setStatus('WhatsApp connected', 'ok')
    } else if (data.status === 'ready') {
      setStatus('Session generated successfully', 'ok')
      session = data.session || ''
      $('session').textContent = MASKED_SESSION$('sessionBox').classList.remove('hidden')

      if (data.sent) {
        const sentTag = $('sent')
        if (sentTag) sentTag.classList.remove('hidden')
      }

      clearInterval(timer)
      $('generate').disabled = false
    } else if (data.status === 'error') {
      setStatus(data.error || 'Pairing failed', 'error')
      clearInterval(timer)
      $('generate').disabled = false
    }
  } catch (err) {
    // Silent fail on transient poll errors
  }
}

$('show').onclick = () => {
  if (!session) return
  revealed = !revealed
  $('session').textContent = revealed ? session : MASKED_SESSION
  $('show').textContent = revealed ? 'Hide Session' : 'Show Session'
  $('copySession').classList.toggle('hidden', !revealed)
}

$('copyCode').onclick = () => {
  copyToClipboard($('code').textContent, $('copyCode'), 'Copy Pair Code')
}

// Enable direct click on code box to copy
$('code').onclick = () => {
  copyToClipboard($('code').textContent, $('copyCode'), 'Copy Pair Code')
}

$('copySession').onclick = () => {
  copyToClipboard(session, $('copySession'), 'Copy Session')
}
