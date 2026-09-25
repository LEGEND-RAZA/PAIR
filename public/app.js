document.addEventListener('DOMContentLoaded', () => {
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
        const textarea = document.createElement('textarea')
        textarea.value = value
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      if (buttonEl) {
        buttonEl.textContent = 'Copied ✓'
        setTimeout(() => {
          buttonEl.textContent = defaultLabel
        }, 1800)
      }
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

    if ($('generate'))$('generate').disabled = true
    if ($('pairBox'))$('pairBox').classList.add('hidden')
    if ($('sessionBox'))$('sessionBox').classList.add('hidden')
    if ($('sent'))$('sent').classList.add('hidden')
    if ($('show'))$('show').textContent = 'Show Session'
    if ($('session'))$('session').textContent = MASKED_SESSION
    if ($('copySession'))$('copySession').classList.add('hidden')
  }

  const generateBtn = $('generate')
  if (generateBtn) {
    generateBtn.onclick = async () => {
      const numEl = $('number')
      const rawInput = numEl ? numEl.value : ''
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

        if (data.code && $('code') && $('pairBox')) {$('code').textContent = data.code
          $('pairBox').classList.remove('hidden')
        }

        setStatus('Waiting for pairing...')
        timer = setInterval(checkStatus, 2000)
      } catch (error) {
        setStatus(error.message || 'Pairing failed', 'error')
        if ($('generate'))$('generate').disabled = false
      }
    }
  }

  async function checkStatus() {
    if (!pairId) return

    try {
      const response = await fetch(`/api/status/${pairId}`, { cache: 'no-store' })
      const data = await response.json()

      if (!data.success) return

      if (data.code && $('code') && $('pairBox')) {$('code').textContent = data.code
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
        if ($('session'))$('session').textContent = MASKED_SESSION
        if ($('sessionBox'))$('sessionBox').classList.remove('hidden')
        if (data.sent && $('sent'))$('sent').classList.remove('hidden')

        clearInterval(timer)
        if ($('generate'))$('generate').disabled = false
      } else if (data.status === 'error') {
        setStatus(data.error || 'Pairing failed', 'error')
        clearInterval(timer)
        if ($('generate'))$('generate').disabled = false
      }
    } catch (err) {}
  }

  if ($('show')) {$('show').onclick = () => {
      if (!session) return
      revealed = !revealed
      if ($('session'))$('session').textContent = revealed ? session : MASKED_SESSION
      $('show').textContent = revealed ? 'Hide Session' : 'Show Session'
      if ($('copySession'))$('copySession').classList.toggle('hidden', !revealed)
    }
  }

  if ($('copyCode')) {$('copyCode').onclick = () => {
      if ($('code')) copyToClipboard($('code').textContent, $('copyCode'), 'Copy Pair Code')
    }
  }

  if ($('code')) {$('code').onclick = () => {
      if ($('code')) copyToClipboard($('code').textContent, $('copyCode'), 'Copy Pair Code')
    }
  }

  if ($('copySession')) {$('copySession').onclick = () => {
      copyToClipboard(session, $('copySession'), 'Copy Session')
    }
  }
})
