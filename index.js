import express from 'express'
import P from 'pino'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  makeWASocket,
  Browsers,
  DisconnectReason,
  useMultiFileAuthState
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'

const app = express()
const PORT = Number(process.env.PORT) || 3000
const ROOT = process.cwd()
const SESSIONS = path.join(ROOT, 'sessions')
const logger = P({ level: 'silent' })
const jobs = new Map()

await fs.mkdir(SESSIONS, { recursive: true })
app.use(express.json({ limit: '2mb' }))
app.use(express.static(path.join(ROOT, 'public')))

function makeId() {
  return crypto.randomBytes(16).toString('hex')
}

function cleanNumber(value) {
  return String(value || '').replace(/\D/g, '')
}

async function cleanupJob(jobId) {
  const job = jobs.get(jobId)
  if (!job) return

  try {
    if (job.sock) {
      job.sock.ev.removeAllListeners('connection.update')
      job.sock.ev.removeAllListeners('creds.update')
      job.sock.ws?.close()
      job.sock.end(undefined)
    }
  } catch {}

  try {
    await fs.rm(job.dir, { recursive: true, force: true })
  } catch {}
}

async function encodeSession(authDir) {
  const files = {}
  const names = await fs.readdir(authDir)

  for (const name of names) {
    const file = path.join(authDir, name)
    const stat = await fs.stat(file)
    if (stat.isFile()) {
      files[name] = (await fs.readFile(file)).toString('base64')
    }
  }

  return 'RAZA~' + Buffer.from(JSON.stringify({
    version: 1,
    files
  })).toString('base64url')
}

async function connectJob(job) {
  const { state, saveCreds } = await useMultiFileAuthState(job.dir)

  const sock = makeWASocket({
    auth: state,
    browser: Browsers.macOS('Desktop'),
    logger,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000
  })

  job.sock = sock
  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update

    if (connection === 'connecting') {
      job.status = 'connecting'
    }

    // Trigger pairing code request once socket opens initial handshakes
    if (
      !state.creds.registered &&
      !job.codeRequested &&
      (connection === 'connecting' || update.qr)
    ) {
      job.codeRequested = true

      // Short delay ensures WebSocket handshake completes before requesting code
      setTimeout(async () => {
        try {
          const rawCode = await sock.requestPairingCode(job.number)
          job.code = rawCode?.match(/.{1,4}/g)?.join('-') || rawCode
          job.status = 'waiting'
        } catch (error) {
          job.status = 'error'
          job.error = error?.message || 'Pairing code request failed'
        }
      }, 3000)
    }

    if (connection === 'open') {
      job.status = 'connected'

      try {
        await saveCreds()
        await new Promise((resolve) => setTimeout(resolve, 1500))

        job.session = await encodeSession(job.dir)
        job.status = 'ready'

        const jid = `${job.number}@s.whatsapp.net`
        const messageText = 
          '╭─❒ ʀᴀᴢᴀ sᴇssɪᴏɴ ❒\n' +
          '│\n' +
          '│ ✓ ᴡʜᴀᴛsᴀᴘᴘ ᴘᴀɪʀᴇᴅ sᴜᴄᴄᴇssғᴜʟʟʏ\n' +
          '│\n' +
          '│ ʏᴏᴜʀ sᴇssɪᴏɴ ɪᴅ:\n' +
          `│ \`${job.session}\`\n` +
          '│\n' +
          '╰────────────'

        try {
          // Send formatted copyable text message
          await sock.sendMessage(jid, { text: messageText })

          // Send session document file
          await sock.sendMessage(jid, {
            document: Buffer.from(job.session),
            mimetype: 'text/plain',
            fileName: 'RAZA-SESSION.txt',
            caption: 'Keep your session ID safe and do not share it with anyone.'
          })

          job.sent = true
        } catch (error) {
          job.sendError = error?.message || 'Could not send session message'
        }

        // Schedule socket closure and directory cleanup to prevent memory leaks
        setTimeout(async () => {
          await cleanupJob(job.id)
        }, 5000)

      } catch (error) {
        job.status = 'error'
        job.error = error?.message || 'Session generation failed'
        await cleanupJob(job.id)
      }
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode

      if (statusCode === DisconnectReason.loggedOut) {
        job.status = 'error'
        job.error = 'WhatsApp logged out'
        await cleanupJob(job.id)
        return
      }

      // Do not attempt reconnect if job reached terminal states
      if (['ready', 'connected', 'error'].includes(job.status)) {
        return
      }

      if (!job.reconnecting) {
        job.reconnecting = true
        setTimeout(async () => {
          try {
            job.reconnecting = false
            await connectJob(job)
          } catch (error) {
            job.status = 'error'
            job.error = error?.message || 'Reconnect failed'
            await cleanupJob(job.id)
          }
        }, 2000)
      }
    }
  })
}

app.get('/health', (req, res) => {
  res.json({ success: true, status: 'online' })
})

app.post('/api/pair', async (req, res) => {
  try {
    const number = cleanNumber(req.body?.number)

    if (number.length < 7 || number.length > 15) {
      return res.status(400).json({
        success: false,
        error: 'Invalid WhatsApp number'
      })
    }

    // Return existing active job for the same number if running
    for (const job of jobs.values()) {
      if (
        job.number === number &&
        !['ready', 'error'].includes(job.status)
      ) {
        return res.json({
          success: true,
          id: job.id,
          code: job.code,
          status: job.status
        })
      }
    }

    const job = {
      id: makeId(),
      number,
      dir: path.join(SESSIONS, crypto.randomBytes(8).toString('hex')),
      code: '',
      status: 'starting',
      session: '',
      sent: false,
      error: '',
      sendError: '',
      codeRequested: false,
      reconnecting: false,
      createdAt: Date.now()
    }

    await fs.mkdir(job.dir, { recursive: true })
    jobs.set(job.id, job)

    connectJob(job).catch(async (error) => {
      job.status = 'error'
      job.error = error?.message || 'Could not start pairing'
      await cleanupJob(job.id)
    })

    // Wait up to 10 seconds for pairing code before responding to client
    for (let i = 0; i < 40; i++) {
      if (job.code || job.status === 'error') break
      await new Promise((resolve) => setTimeout(resolve, 250))
    }

    res.json({
      success: true,
      id: job.id,
      code: job.code,
      status: job.status
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error?.message || 'Internal server error'
    })
  }
})

app.get('/api/status/:id', (req, res) => {
  const job = jobs.get(req.params.id)

  if (!job) {
    return res.status(404).json({
      success: false,
      error: 'Pairing session not found'
    })
  }

  res.json({
    success: true,
    id: job.id,
    status: job.status,
    code: job.code,
    session: job.session,
    sent: job.sent,
    error: job.error,
    sendError: job.sendError
  })
})

// Periodic garbage collection for stagnant jobs (> 10 minutes)
setInterval(async () => {
  const limit = Date.now() - 10 * 60 * 1000

  for (const [jobId, job] of jobs) {
    if (job.createdAt < limit) {
      await cleanupJob(jobId)
      jobs.delete(jobId)
    }
  }
}, 60 * 1000).unref()

app.listen(PORT, () => {
  console.log(`RAZA PAIR running on port ${PORT}`)
})
